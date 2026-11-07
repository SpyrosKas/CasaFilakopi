"use client";

import { ActionForm } from "@/components/admin/form";
import { t } from "@/lib/admin/strings";
import { saveGeneral } from "@/lib/channels/actions";
import { SYNC_INTERVALS, type ChannelSettings } from "@/lib/channels/settings";
import { channelStrings as s } from "@/lib/channels/strings";
import { CHANNELS } from "@/lib/channels/types";

export function GeneralForm({ settings }: { settings: ChannelSettings }) {
  return (
    <ActionForm
      action={saveGeneral}
      submitLabel={s.general.save}
      pendingLabel={t.common.saving}
    >
      <div>
        <label className="choice">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.enabled}
          />
          <span>{s.general.enabled}</span>
        </label>
        <p className="hint">{s.general.enabledHint}</p>
      </div>
      <fieldset>
        <legend>{s.general.channelsLegend}</legend>
        {CHANNELS.map((channel) => (
          <label key={channel} className="choice">
            <input
              type="checkbox"
              name={channel}
              defaultChecked={settings.channels[channel]}
            />
            <span>{s.names[channel]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>{s.general.intervalLegend}</legend>
        {SYNC_INTERVALS.map((minutes) => (
          <label key={minutes} className="choice">
            <input
              type="radio"
              name="intervalMinutes"
              value={minutes}
              defaultChecked={settings.intervalMinutes === minutes}
            />
            <span>{s.general.interval(minutes)}</span>
          </label>
        ))}
      </fieldset>
      <div>
        <label className="choice">
          <input type="checkbox" checked={false} disabled readOnly />
          <span>{s.general.holds}</span>
        </label>
        <p className="hint">{s.general.holdsHint}</p>
      </div>
    </ActionForm>
  );
}
