import { Fragment, type ReactNode } from "react";
import { parseRich, type Inline } from "@/lib/cms/rich";

/** Tags allowed inside messages, for use with t.rich. */
export const richTags = {
  br: () => <br />,
  em: (chunks: ReactNode) => <em>{chunks}</em>,
};

function renderNodes(nodes: Inline[], lineBreak: ReactNode): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.value}</Fragment>;
      case "break":
        return <Fragment key={index}>{lineBreak}</Fragment>;
      case "bold":
        return (
          <strong key={index}>{renderNodes(node.children, lineBreak)}</strong>
        );
      case "italic":
        return <em key={index}>{renderNodes(node.children, lineBreak)}</em>;
      case "link":
        return (
          <a key={index} href={node.href}>
            {renderNodes(node.children, lineBreak)}
          </a>
        );
    }
  });
}

/**
 * Edited text inside an element the page already has, such as a <p>. Line
 * breaks are real <br>, or a small gap where the design wants paragraphs to
 * breathe without splitting the element.
 */
export function RichInline({
  text,
  gap = false,
}: {
  text: string;
  gap?: boolean;
}) {
  const lineBreak = gap ? <span className="paragraph-gap" /> : <br />;
  const between = gap ? (
    <span className="paragraph-gap" />
  ) : (
    <>
      <br />
      <br />
    </>
  );
  return parseRich(text).map((paragraph, index) => (
    <Fragment key={index}>
      {index > 0 && between}
      {renderNodes(paragraph, lineBreak)}
    </Fragment>
  ));
}

/** Long edited text as real paragraphs, for FAQ answers and legal pages. */
export function RichBlocks({ text }: { text: string }) {
  return parseRich(text).map((paragraph, index) => (
    <p key={index}>{renderNodes(paragraph, <br />)}</p>
  ));
}
