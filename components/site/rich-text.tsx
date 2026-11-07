import type { ReactNode } from "react";

/** Tags allowed inside messages, for use with t.rich. */
export const richTags = {
  br: () => <br />,
  em: (chunks: ReactNode) => <em>{chunks}</em>,
};
