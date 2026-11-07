// What every admin screen must pass on a phone, in either language.

export const MIN_TAP = 44;

export interface LayoutProblem {
  kind: string;
  detail: string;
}

/** Runs in the page. Reports sideways scrolling, overflow, small or overlapping targets. */
export function findLayoutProblems(minTap: number): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const name = (el: Element) =>
    `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const width = document.documentElement.clientWidth;

  if (document.documentElement.scrollWidth > width) {
    problems.push({
      kind: "sideways scroll",
      detail: `${document.documentElement.scrollWidth} > ${width}`,
    });
  }

  for (const el of document.querySelectorAll("body *")) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.right > width + 0.5) {
      problems.push({ kind: "past the edge", detail: name(el) });
    }
  }

  const targets = [
    ...document.querySelectorAll(
      "a, button, input:not([type=hidden]):not([type=file]), textarea, select, summary",
    ),
  ]
    .map((el) => {
      // A radio or checkbox is tapped through its whole label.
      const small = el.matches("input[type=radio], input[type=checkbox]");
      const target = small ? (el.closest("label") ?? el) : el;
      return { el: target, box: target.getBoundingClientRect() };
    })
    .filter(
      ({ el, box }) =>
        box.width > 0 &&
        getComputedStyle(el).visibility !== "hidden" &&
        // A closed <details> keeps its layout box but shows nothing.
        (!el.closest("details:not([open])") || el.closest("summary") !== null),
    )
    .filter(({ el, box }) => {
      // A long menu or a tall bar scrolls inside itself. Items at or below its
      // fold are clipped there, so they cannot sit on anything.
      const panel = el.closest(".menu, .inv-bar");
      return !panel || box.bottom <= panel.getBoundingClientRect().bottom + 1;
    });

  for (const { el, box } of targets) {
    if (box.height < minTap - 0.5 || box.width < minTap - 0.5) {
      problems.push({
        kind: "small target",
        detail: `${name(el)} ${Math.round(box.width)}x${Math.round(box.height)}`,
      });
    }
  }

  // Buttons do not break inside a word, so a word too long shows up here.
  for (const el of document.querySelectorAll(".button, .tab, .menu-button")) {
    if (el.scrollWidth > el.clientWidth + 1) {
      problems.push({ kind: "word too wide", detail: name(el) });
    }
  }

  const isPinned = (el: Element) => el.closest("[data-pinned]") !== null;

  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const [a, b] = [targets[i], targets[j]];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // The bottom bar floats over the page by design. That the page can
      // always scroll clear of it is checked below instead.
      if (isPinned(a.el) !== isPinned(b.el)) continue;
      const overlaps =
        a.box.left < b.box.right - 1 &&
        b.box.left < a.box.right - 1 &&
        a.box.top < b.box.bottom - 1 &&
        b.box.top < a.box.bottom - 1;
      if (overlaps) {
        problems.push({
          kind: "overlap",
          detail: `${name(a.el)} and ${name(b.el)}`,
        });
      }
    }
  }

  // At the very bottom of the page, nothing may be left behind the bar. The
  // bar only sits at the bottom on a phone: on a computer it is the side list.
  const bar = document.querySelector("[data-pinned]");
  if (bar && bar.getBoundingClientRect().top > 0) {
    const row = bar.querySelector(".tabbar-row") ?? bar;
    const start = window.scrollY;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const barTop = row.getBoundingClientRect().top;
    for (const { el } of targets) {
      if (!isPinned(el) && el.getBoundingClientRect().bottom > barTop + 0.5) {
        problems.push({ kind: "behind the bottom bar", detail: name(el) });
      }
    }
    window.scrollTo(0, start);
  }
  return problems;
}
