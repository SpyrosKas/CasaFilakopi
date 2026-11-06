import type { Page } from "@playwright/test";

// The layout rules behind T3.1c. Every check here has a matching case in
// layout-checks.spec.ts that injects the problem, proving it can fail.

type Options = {
  /** Check only text inside this element, e.g. an open dialog. */
  root?: string;
  /** Do not scroll: look only at what is on screen right now. */
  firstViewOnly?: boolean;
};

const obstacleSelector = [
  "img",
  "figure",
  "iframe",
  "video",
  ".map-placeholder",
  ".placeholder-notice",
  ".box",
  ".timeline-panel",
  ".cookie-banner",
  ".carousel-indicators li",
  ".site-menu-toggle",
].join(",");

/** Sideways scrolling. */
export async function findOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(
        `page is ${root.scrollWidth}px wide on a ${root.clientWidth}px screen`,
      );
    }
    window.scrollTo(50, window.scrollY);
    if (window.scrollX !== 0) problems.push("page scrolled sideways");
    window.scrollTo(0, window.scrollY);
    return problems;
  });
}

/**
 * Every line of visible text must be: clear of images, figures, frames and
 * panels it is not part of; clear of other text; on screen; not clipped by a
 * container; and the top thing at its own position (elementFromPoint), which
 * catches anything painted over it, whatever that thing is.
 * CSS background photos do not count: heroes are meant to have text on them.
 */
export async function findLayoutProblems(
  page: Page,
  options: Options = {},
): Promise<string[]> {
  return page.evaluate(
    ({ root, firstViewOnly, obstacleSelector }) => {
      const scope = document.querySelector(root);
      if (!scope) return [`${root} not found`];

      const isShown = (element: Element) => {
        if (element.closest(".sr-only, .skip-link")) return false;
        for (let e: Element | null = element; e; e = e.parentElement) {
          const style = getComputedStyle(e);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            Number(style.opacity) === 0
          ) {
            return false;
          }
        }
        return true;
      };

      type Box = {
        left: number;
        right: number;
        top: number;
        bottom: number;
      };
      const overlap = (a: Box, b: Box) => ({
        width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
        height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
      });

      type Line = {
        node: Text;
        parent: Element;
        label: string;
        index: number;
        rect: DOMRect;
      };
      const lines: Line[] = [];
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        const parent = node.parentElement;
        if (!text || !parent || parent.closest("script, style, noscript")) {
          continue;
        }
        if (!isShown(parent)) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        [...range.getClientRects()].forEach((rect, index) => {
          if (rect.width > 0 && rect.height > 0) {
            lines.push({
              node: node as Text,
              parent,
              label: text.slice(0, 40),
              index,
              rect,
            });
          }
        });
      }

      const obstacles = [...scope.querySelectorAll(obstacleSelector)]
        .filter(isShown)
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
          name:
            element.getAttribute("src") ??
            `${element.tagName.toLowerCase()}.${element.className}`,
        }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);

      const visibleNow = (rect: Box) =>
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth;

      const problems: string[] = [];
      const screenWidth = document.documentElement.clientWidth;
      const report = (message: string) => problems.push(message);

      for (const line of lines) {
        const { rect, label, parent, node } = line;
        if (firstViewOnly && !visibleNow(rect)) continue;

        if (rect.left < -1 || rect.right > screenWidth + 1) {
          report(`"${label}" runs off the screen`);
        }

        // Anything over a carousel photo (its buttons) sits there by design.
        const overPhotoOnPurpose = parent.closest(
          ".carousel, .site-dialog__bar",
        );
        for (const { element, rect: box, name } of obstacles) {
          if (element.contains(node)) continue;
          if (overPhotoOnPurpose && element.matches("img, figure")) continue;
          const { width, height } = overlap(rect, box);
          if (width > 1 && height > 1) {
            report(`"${label}" is covered by ${name}`);
          }
        }

        // Font boxes of tight lines touch, so compare the middle of each line.
        const core = (r: DOMRect) => ({
          left: r.left,
          right: r.right,
          top: r.top + r.height * 0.2,
          bottom: r.bottom - r.height * 0.2,
        });
        for (const other of lines) {
          if (other.node === node || other.rect.top < rect.top) continue;
          const { width, height } = overlap(core(rect), core(other.rect));
          if (width > 2 && height > 1) {
            report(`"${label}" overlaps text "${other.label}"`);
          }
        }

        for (let e: Element | null = parent; e; e = e.parentElement) {
          if (e === document.body || e === document.documentElement) break;
          const style = getComputedStyle(e);
          const clips = (value: string) =>
            value === "hidden" || value === "clip";
          const box = e.getBoundingClientRect();
          if (
            (clips(style.overflowX) &&
              (rect.left < box.left - 1 || rect.right > box.right + 1)) ||
            (clips(style.overflowY) &&
              (rect.top < box.top - 1 || rect.bottom > box.bottom + 1))
          ) {
            report(`"${label}" is clipped by ${e.tagName.toLowerCase()}`);
            break;
          }
        }
      }

      // Controls placed over a photo must not sit on one another. These have
      // little or no text, so the text checks above cannot see them.
      const controls = [
        ...scope.querySelectorAll(
          ".carousel-toggle, .carousel-indicators li, .site-dialog__close",
        ),
      ].filter(isShown);
      controls.forEach((control, i) => {
        for (const other of controls.slice(i + 1)) {
          const { width, height } = overlap(
            control.getBoundingClientRect(),
            other.getBoundingClientRect(),
          );
          if (width > 0 && height > 0) {
            report(
              `control ${control.className} overlaps control ${other.className}`,
            );
          }
        }
      });

      // Occlusion: move each line to mid-screen and ask what is on top there.
      const scrollerOf = (element: Element) => {
        for (let e: Element | null = element; e; e = e.parentElement) {
          const overflow = getComputedStyle(e).overflowY;
          if (
            (overflow === "auto" || overflow === "scroll") &&
            e.scrollHeight > e.clientHeight
          ) {
            return e;
          }
        }
        return null;
      };

      const start = { x: window.scrollX, y: window.scrollY };
      for (const line of lines) {
        const range = document.createRange();
        range.selectNodeContents(line.node);
        const lineRect = () => range.getClientRects()[line.index];
        let rect = lineRect();
        if (!rect) continue;

        if (firstViewOnly) {
          if (!visibleNow(rect)) continue;
        } else {
          const shift = rect.top + rect.height / 2 - window.innerHeight / 2;
          const scroller = scrollerOf(line.parent);
          if (scroller) scroller.scrollTop += shift;
          else window.scrollBy(0, shift);
          rect = lineRect();
        }

        const x = Math.min(
          rect.left + rect.width / 2,
          document.documentElement.clientWidth - 1,
        );
        const y = rect.top + rect.height / 2;
        if (y < 0 || y >= window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit.closest("nextjs-portal")) continue;
        if (!line.parent.contains(hit) && !hit.contains(line.parent)) {
          report(
            `"${line.label}" is hidden behind ${hit.tagName.toLowerCase()}.${hit.className}`,
          );
        }
      }
      window.scrollTo(start.x, start.y);

      return [...new Set(problems)];
    },
    {
      root: options.root ?? "body",
      firstViewOnly: options.firstViewOnly ?? false,
      obstacleSelector,
    },
  );
}

/** The hero title and its button are fully on screen, shown and on top. */
export async function findFirstViewProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const targets = document.querySelectorAll<HTMLElement>(
      ".site-hero h1, .site-hero .btn",
    );
    if (targets.length === 0) problems.push("no hero content found");

    targets.forEach((element) => {
      const name = element.textContent?.trim().slice(0, 30);
      const rect = element.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        problems.push(
          `"${name}" is outside the first view (${Math.round(rect.top)} to ${Math.round(rect.bottom)} of ${window.innerHeight})`,
        );
        return;
      }
      for (let e: Element | null = element; e; e = e.parentElement) {
        if (Number(getComputedStyle(e).opacity) < 1) {
          problems.push(`"${name}" is not fully shown`);
          return;
        }
      }
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      if (hit && !element.contains(hit) && !hit.contains(element)) {
        problems.push(`"${name}" is covered by ${hit.tagName.toLowerCase()}`);
      }
    });
    return problems;
  });
}

/** Ends every transition, so checks see the final layout at once. */
export async function freezeMotion(page: Page) {
  await page.addStyleTag({
    content:
      "*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important}",
  });
}
