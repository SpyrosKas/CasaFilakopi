"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { LineIcon } from "./line-icon";

type Panel = { id: string; title: string; content: ReactNode };

const OpenPanelContext = createContext<(id: string) => void>(() => {});

/** One panel open at a time. */
export function Accordion({ panels }: { panels: Panel[] }) {
  const [openId, setOpenId] = useState<string | null>(panels[0]?.id ?? null);

  return (
    <OpenPanelContext.Provider value={setOpenId}>
      <div className="accordion">
        {panels.map(({ id, title, content }) => {
          const open = id === openId;
          return (
            <div className="card" key={id}>
              <div className="card-header" id={`heading-${id}`}>
                <h2>
                  <button
                    className="accordion__toggle"
                    type="button"
                    aria-expanded={open}
                    aria-controls={`panel-${id}`}
                    onClick={() => setOpenId(open ? null : id)}
                  >
                    {title}
                    <LineIcon name="chevronDown" />
                  </button>
                </h2>
              </div>
              <div
                id={`panel-${id}`}
                hidden={!open}
                role="region"
                aria-labelledby={`heading-${id}`}
              >
                <div className="card-body">{content}</div>
              </div>
            </div>
          );
        })}
      </div>
    </OpenPanelContext.Provider>
  );
}

/** A link inside one panel that opens another panel. */
export function AccordionLink({
  panelId,
  children,
}: {
  panelId: string;
  children: ReactNode;
}) {
  const openPanel = useContext(OpenPanelContext);
  return (
    <button
      type="button"
      className="link-button"
      onClick={() => {
        openPanel(panelId);
        document.getElementById(`heading-${panelId}`)?.scrollIntoView();
      }}
    >
      {children}
    </button>
  );
}
