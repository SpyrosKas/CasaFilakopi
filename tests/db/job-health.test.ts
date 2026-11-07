import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import type { EmailDb } from "@/lib/email/db";
import { alertAboutJob } from "@/lib/email/jobs";
import { db } from "./helpers";

// JOB-09 on the real queue. Each test uses a job name of its own.

const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; SECRET_KEY: string };

if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) {
  throw new Error("Database tests run against local Supabase only");
}

const client: EmailDb = createClient<Database>(
  status.API_URL,
  status.SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const jobs: string[] = [];
const label = (job: string) => `Label ${job}`;

async function runs(...statuses: string[]) {
  const job = `test_${randomUUID()}`;
  jobs.push(job);
  for (const run of statuses) {
    await db.query(
      `insert into public.job_runs (job, status, finished_at, detail)
       values ($1, $2, now(), 'column does not exist')`,
      [job, run],
    );
  }
  return job;
}

const alertsFor = async (job: string) => {
  const { rows } = await db.query(
    `select payload from public.email_logs
     where template_key = 'host_job_failure' and payload ->> 'job' = $1`,
    [label(job)],
  );
  return rows;
};

afterAll(async () => {
  await db.query(
    `delete from public.email_logs
     where template_key = 'host_job_failure' and payload ->> 'job' = any($1)`,
    [jobs.map(label)],
  );
  await db.query(`delete from public.job_runs where job = any($1)`, [jobs]);
  await db.end();
});

describe("alertAboutJob", () => {
  const now = new Date();

  it("alerts the host once a job has failed three times running", async () => {
    const job = await runs("failed", "failed", "failed");
    expect(await alertAboutJob(client, job, label(job), now)).toBe(true);
    const rows = await alertsFor(job);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].payload).toMatchObject({
      failures: 3,
      error: "column does not exist",
    });
  });

  it("alerts only once a day, however often it is asked", async () => {
    const job = await runs("failed", "failed", "failed");
    await alertAboutJob(client, job, label(job), now);
    const first = (await alertsFor(job)).length;
    await alertAboutJob(client, job, label(job), now);
    expect(await alertsFor(job)).toHaveLength(first);
  });

  it("stays quiet for a single failure", async () => {
    const job = await runs("success", "failed");
    expect(await alertAboutJob(client, job, label(job), now)).toBe(false);
    expect(await alertsFor(job)).toHaveLength(0);
  });

  it("stays quiet once the job has recovered", async () => {
    const job = await runs("failed", "failed", "failed", "success");
    expect(await alertAboutJob(client, job, label(job), now)).toBe(false);
    expect(await alertsFor(job)).toHaveLength(0);
  });
});
