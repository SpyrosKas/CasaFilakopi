import { adminI18n } from "@/lib/admin/i18n-server";

/** Only ever rendered for a signed-in Owner in preview. */
export async function PreviewBanner() {
  const { cms: t } = await adminI18n();
  return (
    <div
      role="status"
      data-preview-banner
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2000,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "center",
        gap: "4px 16px",
        padding: "6px 16px",
        background: "#7a4b00",
        color: "#fff",
        fontSize: "15px",
      }}
    >
      <span>{t.editor.previewBanner}</span>
      {/* A route handler, reached by a full page load. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/admin/content/preview/exit"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 44,
          color: "#fff",
          fontWeight: 600,
        }}
      >
        {t.editor.previewClose}
      </a>
    </div>
  );
}
