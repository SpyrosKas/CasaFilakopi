import { notFound } from "next/navigation";

// Any unknown path under a locale gets the styled, translated 404.
export default function CatchAll() {
  notFound();
}
