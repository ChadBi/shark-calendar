import { R as React, c as constructFrom, n as normalizeDates, s as startOfDay$1, D as DEFAULT_SETTINGS, a as shiftCursor, r as reactExports, e as eventsOnDay, j as jsxRuntimeExports, b as colorOf, f as fmtTime, I as Icon, m as monthMatrix, W as WEEKDAY_LABELS, i as isSameMonth, l as layoutDay, d as WEEKDAY_FULL, g as durationLabel, E as EVENT_COLORS, h as format, k as fmtDayLabel, v as viewTitle, w as weekDays, o as client } from "./Icon-CMfSLfH_.js";
const createStoreImpl = (createState) => {
  let state;
  const listeners = /* @__PURE__ */ new Set();
  const setState = (partial, replace) => {
    const nextState = typeof partial === "function" ? partial(state) : partial;
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = (replace != null ? replace : typeof nextState !== "object" || nextState === null) ? nextState : Object.assign({}, state, nextState);
      listeners.forEach((listener) => listener(state, previousState));
    }
  };
  const getState = () => state;
  const getInitialState = () => initialState;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const api = { setState, getState, getInitialState, subscribe };
  const initialState = state = createState(setState, getState, api);
  return api;
};
const createStore = (createState) => createState ? createStoreImpl(createState) : createStoreImpl;
const identity = (arg) => arg;
function useStore(api, selector = identity) {
  const slice = React.useSyncExternalStore(
    api.subscribe,
    React.useCallback(() => selector(api.getState()), [api, selector]),
    React.useCallback(() => selector(api.getInitialState()), [api, selector])
  );
  React.useDebugValue(slice);
  return slice;
}
const createImpl = (createState) => {
  const api = createStore(createState);
  const useBoundStore = (selector) => useStore(api, selector);
  Object.assign(useBoundStore, api);
  return useBoundStore;
};
const create = (createState) => createImpl;
function constructNow(date) {
  return constructFrom(date, Date.now());
}
function isSameDay(laterDate, earlierDate, options) {
  const [dateLeft_, dateRight_] = normalizeDates(
    options?.in,
    laterDate,
    earlierDate
  );
  return +startOfDay$1(dateLeft_) === +startOfDay$1(dateRight_);
}
function isToday(date, options) {
  return isSameDay(
    constructFrom(date, date),
    constructNow(date)
  );
}
let toastTimer = null;
const useApp = create()((set, get) => ({
  ready: false,
  events: [],
  settings: DEFAULT_SETTINGS,
  view: "month",
  cursor: /* @__PURE__ */ new Date(),
  editing: null,
  settingsOpen: false,
  quickAddOpen: false,
  toast: null,
  init: async () => {
    const data = await window.api.getData();
    set({
      ready: true,
      events: data.events,
      settings: data.settings,
      view: data.settings.defaultView ?? "month"
    });
    window.api.onDataChanged((d) => set({ events: d.events, settings: d.settings }));
    window.api.onQuickAdd(() => set({ quickAddOpen: true }));
    window.api.onOpenEvent((id) => {
      const ev = get().events.find((e) => e.id === id);
      if (ev) get().openEdit(ev);
    });
  },
  setView: (v) => set({ view: v }),
  setCursor: (d) => set({ cursor: d }),
  step: (dir) => set((s) => ({ cursor: shiftCursor(s.cursor, s.view, dir) })),
  goToday: () => set({ cursor: /* @__PURE__ */ new Date() }),
  openNew: (start, allDay = false) => {
    const base = start ?? /* @__PURE__ */ new Date();
    const s = allDay ? startOfDay$1(base) : base;
    const e = allDay ? new Date(startOfDay$1(base).getTime() + 864e5) : new Date(s.getTime() + 60 * 6e4);
    set({
      editing: { title: "", start: s, end: e, allDay, color: "blue" }
    });
  },
  openEdit: (ev) => {
    set({
      editing: {
        id: ev.id,
        title: ev.title,
        start: new Date(ev.start),
        end: new Date(ev.end),
        allDay: ev.allDay,
        color: ev.color,
        notes: ev.notes
      }
    });
  },
  closeEditor: () => set({ editing: null }),
  saveEvent: async (draft) => {
    await window.api.upsertEvent({
      id: draft.id,
      title: draft.title.trim() || "未命名日程",
      start: draft.start.toISOString(),
      end: draft.end.toISOString(),
      allDay: draft.allDay,
      color: draft.color,
      notes: draft.notes
    });
    set({ editing: null });
    get().showToast(draft.id ? "已更新" : "已创建");
  },
  removeEvent: async (id) => {
    await window.api.deleteEvent(id);
    set({ editing: null });
    get().showToast("已删除");
  },
  patchSettings: async (p) => {
    const next = await window.api.patchSettings(p);
    set({ settings: next });
  },
  setSettingsOpen: (b) => set({ settingsOpen: b }),
  setQuickAddOpen: (b) => set({ quickAddOpen: b }),
  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 1800);
  }
}));
function MiniMonth({ events, cursor, weekStartsOn, onSelect }) {
  const [anchor, setAnchor] = reactExports.useState(() => startOfDay$1(cursor));
  const days = reactExports.useMemo(() => monthMatrix(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const labels = reactExports.useMemo(
    () => weekStartsOn === 1 ? WEEKDAY_LABELS : [WEEKDAY_LABELS[6], ...WEEKDAY_LABELS.slice(0, 6)],
    [weekStartsOn]
  );
  const busy = reactExports.useMemo(() => {
    const set = /* @__PURE__ */ new Set();
    for (const e of events) {
      const d = startOfDay$1(new Date(e.start)).toDateString();
      set.add(d);
    }
    return set;
  }, [events]);
  const shift = (delta) => {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() + delta, 1);
    setAnchor(d);
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-section", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mini-head", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "mini-title", children: [
        anchor.getFullYear(),
        " 年 ",
        anchor.getMonth() + 1,
        " 月"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mini-nav", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn plain", onClick: () => shift(-1), title: "上个月", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevronLeft", size: 13 }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn plain", onClick: () => shift(1), title: "下个月", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevronRight", size: 13 }) })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "mini-grid", children: [
      labels.map((l) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mini-dow", children: l }, l)),
      days.map((d) => {
        const cls = [
          "mini-cell",
          isSameMonth(d, anchor) ? "" : "out",
          isToday(d) ? "today" : "",
          isSameDay(d, cursor) && !isToday(d) ? "sel" : ""
        ].filter(Boolean).join(" ");
        return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: cls, onClick: () => onSelect(d), children: [
          d.getDate(),
          busy.has(startOfDay$1(d).toDateString()) && !isToday(d) && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot" })
        ] }, d.toISOString());
      })
    ] })
  ] });
}
function Sidebar({
  events,
  cursor,
  weekStartsOn,
  hour24,
  onJump,
  onEdit,
  onNew,
  onOpenSettings,
  onToggleWidget
}) {
  const today = /* @__PURE__ */ new Date();
  const todays = reactExports.useMemo(() => eventsOnDay(events, today), [events, today]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "sidebar", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "brand", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "brand-mark", children: "日" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "brand-name", children: "日程" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-scroll", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(MiniMonth, { events, cursor, weekStartsOn, onSelect: onJump }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-section", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-title", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "今天" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { textTransform: "none", letterSpacing: 0, fontWeight: 500 }, children: [
            todays.length,
            " 项"
          ] })
        ] }),
        todays.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-hint", children: [
          "今天还没有安排",
          /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
          "按 ",
          /* @__PURE__ */ jsxRuntimeExports.jsx("kbd", { children: "Ctrl" }),
          "+",
          /* @__PURE__ */ jsxRuntimeExports.jsx("kbd", { children: "Alt" }),
          "+",
          /* @__PURE__ */ jsxRuntimeExports.jsx("kbd", { children: "N" }),
          " 快速新建"
        ] }),
        todays.slice(0, 8).map((ev) => {
          const c = colorOf(ev.color);
          return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "today-item", onClick: () => onEdit(ev), children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "today-bar", style: { background: c.dot } }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 0, flex: 1 }, children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "today-name", children: ev.title }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "today-time", children: ev.allDay ? "全天" : fmtTime(new Date(ev.start), hour24) })
            ] })
          ] }, ev.id);
        }),
        todays.length > 8 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "empty-hint", style: { padding: "4px 8px" }, children: [
          "还有 ",
          todays.length - 8,
          " 项…"
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sidebar-foot", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "btn ghost", onClick: onToggleWidget, title: "显示 / 隐藏桌面悬浮窗", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "monitor", size: 14 }),
        "桌面组件"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn plain", onClick: onOpenSettings, title: "设置", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "settings", size: 15 }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn plain", onClick: onNew, title: "新建日程", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "plus", size: 16, strokeWidth: 2.1 }) })
    ] })
  ] });
}
const CHIP_H = 19;
const CHIP_GAP = 2;
const CELL_CHROME = 20 + 16 + 9;
function MonthView({
  events,
  cursor,
  weekStartsOn,
  hour24,
  onNew,
  onEdit,
  onOpenDay
}) {
  const days = reactExports.useMemo(() => monthMatrix(cursor, weekStartsOn), [cursor, weekStartsOn]);
  const gridRef = reactExports.useRef(null);
  const [maxChips, setMaxChips] = reactExports.useState(2);
  reactExports.useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const calc = () => {
      const cellH = (el.clientHeight - 5 * 6) / 6;
      const available = cellH - CELL_CHROME;
      const n = Math.floor((available + CHIP_GAP) / (CHIP_H + CHIP_GAP));
      setMaxChips(Math.max(1, Math.min(6, n)));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const byDay = reactExports.useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const d of days) {
      map.set(d.toDateString(), eventsOnDay(events, d));
    }
    return map;
  }, [days, events]);
  const labels = reactExports.useMemo(() => {
    if (weekStartsOn === 1) return WEEKDAY_LABELS;
    return [WEEKDAY_LABELS[6], ...WEEKDAY_LABELS.slice(0, 6)];
  }, [weekStartsOn]);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "month-view", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "month-head", children: labels.map((l, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: i >= 5 ? "weekend" : "", children: l }, l)) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "month-grid", ref: gridRef, children: days.map((day) => {
      const list = byDay.get(day.toDateString()) ?? [];
      const out = !isSameMonth(day, cursor);
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      const shown = list.slice(0, maxChips);
      const rest = list.length - shown.length;
      return /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "div",
        {
          className: [
            "month-cell",
            out ? "out" : "",
            weekend ? "weekend" : "",
            isToday(day) ? "today" : ""
          ].filter(Boolean).join(" "),
          onDoubleClick: () => onNew(startOfDay$1(day)),
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cell-top", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "day-num", children: day.getDate() }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "button",
                {
                  className: "cell-add",
                  title: "在这天新建日程",
                  onClick: (e) => {
                    e.stopPropagation();
                    onNew(startOfDay$1(day));
                  },
                  children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "plus", size: 13, strokeWidth: 2.2 })
                }
              )
            ] }),
            shown.map((ev) => {
              const c = colorOf(ev.color);
              return /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "div",
                {
                  className: "chip",
                  style: { background: c.bg, color: c.fg },
                  title: `${ev.title} · ${fmtTime(new Date(ev.start), hour24)}`,
                  onClick: (e) => {
                    e.stopPropagation();
                    onEdit(ev);
                  },
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip-dot", style: { background: c.dot } }),
                    !ev.allDay && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip-time", children: fmtTime(new Date(ev.start), hour24) }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip-text", children: ev.title })
                  ]
                },
                ev.id
              );
            }),
            rest > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                className: "more-link",
                onClick: (e) => {
                  e.stopPropagation();
                  onOpenDay(day);
                },
                children: [
                  "还有 ",
                  rest,
                  " 项"
                ]
              }
            )
          ]
        },
        day.toISOString()
      );
    }) })
  ] });
}
const HOUR_H = 52;
const TOTAL_MIN = 1440;
function TimeGrid({ events, days, hour24, bare, onNew, onEdit, onOpenDay }) {
  const scrollRef = reactExports.useRef(null);
  const colCount = days.length;
  const slotsByDay = reactExports.useMemo(
    () => days.map((d) => layoutDay(events, d)),
    [days, events]
  );
  const allDayByDay = reactExports.useMemo(
    () => days.map((d) => eventsOnDay(events, d).filter((e) => e.allDay)),
    [days, events]
  );
  const hasAllDay = allDayByDay.some((l) => l.length > 0);
  reactExports.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now2 = /* @__PURE__ */ new Date();
    const anchor = isToday(days[0]) || days.some((d) => isToday(d)) ? now2.getHours() : 8;
    el.scrollTop = Math.max(0, (anchor - 2) * HOUR_H);
  }, [days]);
  const now = /* @__PURE__ */ new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const showNow = days.some((d) => isToday(d));
  return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: `timeline-wrap${bare ? " bare" : ""}`, ref: scrollRef, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "timeline", style: { gridTemplateColumns: "54px minmax(0,1fr)" }, children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tl-head", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tl-head-gutter" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tl-head-days", style: { gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))` }, children: days.map((d) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "div",
        {
          className: `tl-head-day${isToday(d) ? " today" : ""}`,
          onClick: () => onOpenDay(d),
          title: "打开这一天的详情",
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tl-dow", children: WEEKDAY_FULL[(d.getDay() + 6) % 7] }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tl-date", children: d.getDate() })
          ]
        },
        d.toISOString()
      )) })
    ] }),
    hasAllDay && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "allday-row", style: { gridColumn: "1 / -1" }, children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "allday-label", children: "全天" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "allday-cells", style: { gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))` }, children: allDayByDay.map((list, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "allday-cell", children: list.map((ev) => {
        const c = colorOf(ev.color);
        return /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "div",
          {
            className: "chip",
            style: { background: c.bg, color: c.fg },
            onClick: () => onEdit(ev),
            title: ev.title,
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip-dot", style: { background: c.dot } }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chip-text", children: ev.title })
            ]
          },
          ev.id
        );
      }) }, i)) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tl-gutter", style: { height: TOTAL_MIN * (HOUR_H / 60) }, children: Array.from({ length: 24 }, (_, h) => h).map(
      (h) => h === 0 ? null : /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tl-hour-label", style: { top: h * HOUR_H }, children: hour24 ? `${String(h).padStart(2, "0")}:00` : `${h % 12 || 12}${h < 12 ? "am" : "pm"}` }, h)
    ) }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "div",
      {
        className: "tl-cols",
        style: {
          gridTemplateColumns: `repeat(${colCount}, minmax(0,1fr))`,
          height: TOTAL_MIN * (HOUR_H / 60),
          ["--hour-h"]: `${HOUR_H}px`
        },
        children: days.map((day, di) => {
          const weekend = day.getDay() === 0 || day.getDay() === 6;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "div",
            {
              className: `tl-col${weekend ? " weekend" : ""}`,
              onClick: (e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = (e.clientY - rect.top) / rect.height;
                const mins = Math.min(23 * 60 + 30, Math.max(0, Math.round(ratio * TOTAL_MIN / 30) * 30));
                const d = startOfDay$1(day);
                d.setMinutes(mins);
                onNew(d);
              },
              children: [
                isToday(day) && showNow && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "now-line", style: { top: `${nowMin / TOTAL_MIN * 100}%` } }),
                slotsByDay[di].map((slot) => {
                  const c = colorOf(slot.event.color);
                  const top = slot.startMin / TOTAL_MIN * 100;
                  const height = (slot.endMin - slot.startMin) / TOTAL_MIN * 100;
                  const widthPct = 100 / slot.cols;
                  const compact = slot.endMin - slot.startMin < 42;
                  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
                    "div",
                    {
                      className: `slot${compact ? " compact" : ""}`,
                      style: {
                        top: `${top}%`,
                        height: `${height}%`,
                        left: `calc(${slot.col * widthPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        background: c.bg,
                        color: c.fg,
                        borderLeftColor: c.dot
                      },
                      title: `${slot.event.title}
${fmtTime(new Date(slot.event.start), hour24)} – ${fmtTime(new Date(slot.event.end), hour24)}`,
                      onClick: (e) => {
                        e.stopPropagation();
                        onEdit(slot.event);
                      },
                      children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "slot-title", children: slot.event.title }),
                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "slot-time", children: [
                          fmtTime(new Date(slot.event.start), hour24),
                          slot.continuesAfter ? " →" : ""
                        ] })
                      ]
                    },
                    slot.event.id
                  );
                })
              ]
            },
            day.toISOString()
          );
        })
      }
    )
  ] }) });
}
const toDateStr = (d) => format(d, "yyyy-MM-dd");
const toTimeStr = (d) => format(d, "HH:mm");
function EventEditor({ draft, onSave, onDelete, onClose }) {
  const [title, setTitle] = reactExports.useState(draft.title);
  const [dateStr, setDateStr] = reactExports.useState(toDateStr(draft.start));
  const [startStr, setStartStr] = reactExports.useState(toTimeStr(draft.start));
  const [endStr, setEndStr] = reactExports.useState(toTimeStr(draft.end));
  const [allDay, setAllDay] = reactExports.useState(draft.allDay);
  const [color, setColor] = reactExports.useState(draft.color);
  const [notes, setNotes] = reactExports.useState(draft.notes ?? "");
  const titleRef = reactExports.useRef(null);
  reactExports.useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);
  const { start, end } = reactExports.useMemo(() => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const [sh, sm] = startStr.split(":").map(Number);
    const [eh, em] = endStr.split(":").map(Number);
    if (allDay) {
      const s2 = new Date(y, m - 1, d, 0, 0, 0, 0);
      return { start: s2, end: new Date(s2.getTime() + 864e5) };
    }
    const s = new Date(y, m - 1, d, sh || 0, sm || 0, 0, 0);
    let e = new Date(y, m - 1, d, eh || 0, em || 0, 0, 0);
    if (e.getTime() <= s.getTime()) e = new Date(e.getTime() + 864e5);
    return { start: s, end: e };
  }, [dateStr, startStr, endStr, allDay]);
  const commit = () => {
    onSave({
      id: draft.id,
      title: title.trim() || "未命名日程",
      start,
      end,
      allDay,
      color,
      notes: notes.trim() || void 0
    });
  };
  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit();
    }
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      className: "overlay",
      onMouseDown: (e) => {
        if (e.target === e.currentTarget) onClose();
      },
      onKeyDown,
      children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal", onKeyDown, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: draft.id ? "编辑日程" : "新建日程" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn plain", onClick: onClose, title: "关闭", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "x", size: 15 }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-body", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              ref: titleRef,
              className: "title-input",
              placeholder: "要做什么？",
              value: title,
              onChange: (e) => setTitle(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  commit();
                }
              }
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "field-row", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "field-label", children: "日期" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "date",
                className: "input",
                style: { flex: 1 },
                value: dateStr,
                onChange: (e) => setDateStr(e.target.value)
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                className: "btn ghost",
                onClick: () => {
                  const t = /* @__PURE__ */ new Date();
                  setDateStr(toDateStr(t));
                },
                children: "今天"
              }
            )
          ] }),
          !allDay && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "field-row", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "field-label", children: "时间" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "time",
                className: "input",
                style: { flex: 1 },
                value: startStr,
                onChange: (e) => setStartStr(e.target.value)
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { color: "var(--text-3)" }, children: "–" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "time",
                className: "input",
                style: { flex: 1 },
                value: endStr,
                onChange: (e) => setEndStr(e.target.value)
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 11.5, color: "var(--text-3)", width: 62, textAlign: "right" }, children: durationLabel(start, end) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "field-row", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "field-label", children: "全天" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                className: `switch${allDay ? " on" : ""}`,
                onClick: () => setAllDay((v) => !v),
                "aria-pressed": allDay
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "spacer" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "field-label", style: { width: "auto" }, children: "颜色" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "color-row", children: EVENT_COLORS.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                className: `color-dot${color === c.key ? " active" : ""}`,
                style: { background: c.dot, color: c.dot },
                onClick: () => setColor(c.key),
                title: c.label
              },
              c.key
            )) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "textarea",
            {
              className: "textarea",
              placeholder: "备注（可选）",
              value: notes,
              onChange: (e) => setNotes(e.target.value)
            }
          ) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-foot", children: [
          draft.id && onDelete && /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "btn danger", onClick: () => onDelete(draft.id), children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "trash", size: 13 }),
            "删除"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "spacer" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { style: { fontSize: 11, color: "var(--text-3)" }, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("kbd", { children: "Ctrl" }),
            " + ",
            /* @__PURE__ */ jsxRuntimeExports.jsx("kbd", { children: "Enter" }),
            " 保存"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "btn", onClick: onClose, children: "取消" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "btn primary", onClick: commit, children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "check", size: 13, strokeWidth: 2.4 }),
            "保存"
          ] })
        ] })
      ] })
    }
  );
}
const CN_DIGITS = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
};
function cnNumber(raw) {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === "十") return 10;
  if (raw.includes("十")) {
    const [a, b] = raw.split("十");
    const tens = a ? CN_DIGITS[a] ?? 0 : 1;
    const ones = b ? CN_DIGITS[b] ?? 0 : 0;
    return tens * 10 + ones;
  }
  if (raw.length === 1 && raw in CN_DIGITS) return CN_DIGITS[raw];
  return null;
}
const WEEKDAY_MAP = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
  七: 0
};
function atTime(base, hours, minutes) {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function parseQuickAdd(input, now = /* @__PURE__ */ new Date()) {
  let text = ` ${input.trim()} `;
  if (!text.trim()) return null;
  let hasDate = false;
  let hasTime = false;
  let targetDay = startOfDay(now);
  let hour = null;
  let minute = 0;
  let durationMin = 60;
  let allDay = false;
  const durH = text.match(/(\d+(?:\.\d+)?)\s*个?\s*(?:小时|钟头|h)/i);
  if (durH) {
    durationMin = Math.round(parseFloat(durH[1]) * 60);
    text = text.replace(durH[0], " ");
  } else {
    const durM = text.match(/(\d+)\s*分钟/);
    if (durM) {
      durationMin = Number(durM[1]);
      text = text.replace(durM[0], " ");
    }
  }
  const rel = text.match(/(大后天|后天|明天|明日|今天|今日)/);
  if (rel) {
    const offset = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3 }[rel[1]];
    targetDay = startOfDay(new Date(now.getTime() + offset * 864e5));
    hasDate = true;
    text = text.replace(rel[0], " ");
  }
  if (!hasDate) {
    const wk = text.match(/(下下|下|本|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (wk) {
      const target = /[1-7]/.test(wk[2]) ? Number(wk[2]) % 7 : WEEKDAY_MAP[wk[2]];
      const prefix = wk[1] ?? "";
      const todayDow = now.getDay();
      let delta = (target - todayDow + 7) % 7;
      if (prefix === "下") delta += 7;
      if (prefix === "下下") delta += 14;
      targetDay = startOfDay(new Date(now.getTime() + delta * 864e5));
      hasDate = true;
      text = text.replace(wk[0], " ");
    }
  }
  if (!hasDate) {
    const md = text.match(/(\d{1,2})\s*[月\/\-]\s*(\d{1,2})\s*[日号]?/);
    if (md) {
      const month = Number(md[1]);
      const day = Number(md[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const d = new Date(now.getFullYear(), month - 1, day);
        if (d.getTime() < startOfDay(now).getTime() - 864e5) d.setFullYear(d.getFullYear() + 1);
        targetDay = startOfDay(d);
        hasDate = true;
        text = text.replace(md[0], " ");
      }
    }
  }
  const periodMatch = text.match(/(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|晚)/);
  const period = periodMatch ? periodMatch[1] : "";
  const hm = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (hm) {
    hour = Number(hm[1]);
    minute = Number(hm[2]);
    hasTime = true;
    text = text.replace(hm[0], " ");
  } else {
    const h = text.match(/(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*[点时](半|\d{1,2}\s*分?)?/);
    if (h) {
      const n = cnNumber(h[1]);
      if (n !== null && n >= 0 && n <= 24) {
        hour = n;
        hasTime = true;
        if (h[2]) {
          if (h[2] === "半") minute = 30;
          else minute = Number(h[2].replace(/[^\d]/g, "")) || 0;
        }
        text = text.replace(h[0], " ");
      }
    }
  }
  if (periodMatch) text = text.replace(periodMatch[0], " ");
  if (hour !== null) {
    if (["下午", "傍晚", "晚上", "夜里", "晚"].includes(period) && hour < 12) hour += 12;
    else if (period === "中午" && hour < 12) hour += 12;
    else if (["凌晨", "清晨", "早上", "早晨", "上午"].includes(period) && hour === 12) hour = 0;
    if (hour === 24) hour = 0;
  }
  if (/全天|整日/.test(text)) {
    allDay = true;
    text = text.replace(/全天|整日/, " ");
  }
  if (!hasTime) {
    if (allDay) {
      hour = 0;
      minute = 0;
    } else if (hasDate) {
      hour = 9;
      minute = 0;
    } else {
      const next = new Date(now.getTime() + 30 * 6e4);
      next.setMinutes(next.getMinutes() > 30 ? 60 : 30, 0, 0);
      targetDay = startOfDay(next);
      hour = next.getHours();
      minute = next.getMinutes();
    }
  }
  const title = text.replace(/[,，。;；!！?？]/g, " ").replace(/\s+/g, " ").trim();
  if (!title) return null;
  const start = allDay ? startOfDay(targetDay) : atTime(targetDay, hour ?? 9, minute);
  const end = allDay ? new Date(startOfDay(targetDay).getTime() + 864e5) : new Date(start.getTime() + durationMin * 6e4);
  return { title, start, end, allDay, hasDate, hasTime };
}
function QuickAdd() {
  const [text, setText] = reactExports.useState("");
  const ref = reactExports.useRef(null);
  const setOpen = useApp((s) => s.setQuickAddOpen);
  const saveEvent = useApp((s) => s.saveEvent);
  const openNew = useApp((s) => s.openNew);
  reactExports.useEffect(() => {
    ref.current?.focus();
  }, []);
  const parsed = reactExports.useMemo(() => text.trim() ? parseQuickAdd(text) : null, [text]);
  const submit = () => {
    if (!parsed) {
      if (text.trim()) {
        setOpen(false);
        openNew();
      } else {
        setOpen(false);
      }
      return;
    }
    void saveEvent({
      title: parsed.title,
      start: parsed.start,
      end: parsed.end,
      allDay: parsed.allDay,
      color: "blue"
    });
    setOpen(false);
  };
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      className: "quickadd-overlay",
      onMouseDown: (e) => {
        if (e.target === e.currentTarget) setOpen(false);
      },
      children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "quickadd", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "qa-input-row", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "plus", size: 17, strokeWidth: 2.2 }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              ref,
              className: "qa-input",
              placeholder: "明天下午3点 和设计对需求 1小时",
              value: text,
              onChange: (e) => setText(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") setOpen(false);
              }
            }
          ),
          text && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn plain", onClick: () => setText(""), title: "清空", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "x", size: 14 }) })
        ] }),
        parsed ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "qa-preview", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "clock", size: 14 }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("strong", { children: parsed.title }),
            " · ",
            fmtDayLabel(parsed.start),
            !parsed.allDay && ` ${fmtTime(parsed.start)} – ${fmtTime(parsed.end)}`,
            parsed.allDay && " 全天"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "spacer" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { style: { fontSize: 11, color: "var(--text-3)" }, children: "回车保存" })
        ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "qa-hint", children: [
          "试试：",
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { children: "明天 3 点 开会" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { children: "周五 14:30 评审 2 小时" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { children: "10/20 体检" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("code", { children: "下周一 站会 30 分钟" })
        ] })
      ] })
    }
  );
}
function Row({
  label,
  desc,
  children
}) {
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "setting-row", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "setting-label", children: label }),
      desc && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "setting-desc", children: desc })
    ] }),
    children
  ] });
}
function Switch({ on, onClick }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: `switch${on ? " on" : ""}`, onClick, "aria-pressed": on });
}
function SettingsPanel() {
  const settings = useApp((s) => s.settings);
  const patch = useApp((s) => s.patchSettings);
  const close = useApp((s) => s.setSettingsOpen);
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "div",
    {
      className: "overlay",
      onMouseDown: (e) => {
        if (e.target === e.currentTarget) close(false);
      },
      children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal settings-sheet", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { children: "设置" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn plain", onClick: () => close(false), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "x", size: 15 }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-body", style: { paddingBottom: 14 }, children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sidebar-title", style: { padding: "4px 0 0" }, children: "窗口行为" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "关闭窗口时隐藏到托盘", desc: "应用继续在后台运行，日程提醒不受影响", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Switch, { on: settings.closeToTray, onClick: () => patch({ closeToTray: !settings.closeToTray }) }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "最小化时隐藏到托盘", desc: "关闭后最小化按钮会把窗口收进托盘，而不是任务栏", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              on: settings.minimizeToTray,
              onClick: () => patch({ minimizeToTray: !settings.minimizeToTray })
            }
          ) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "开机自动启动", desc: "登录 Windows 后自动在托盘运行", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              on: settings.launchAtLogin,
              onClick: () => patch({ launchAtLogin: !settings.launchAtLogin })
            }
          ) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sidebar-title", style: { padding: "10px 0 0" }, children: "桌面悬浮窗" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "窗口置顶", desc: "始终显示在其他窗口上方", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              on: settings.widgetAlwaysOnTop,
              onClick: () => patch({ widgetAlwaysOnTop: !settings.widgetAlwaysOnTop })
            }
          ) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "启动时显示", desc: "应用启动后自动把悬浮窗贴到桌面", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            Switch,
            {
              on: settings.showWidgetOnStart,
              onClick: () => patch({ showWidgetOnStart: !settings.showWidgetOnStart })
            }
          ) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "背景不透明度", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              type: "range",
              className: "range",
              min: 0.35,
              max: 1,
              step: 0.01,
              value: settings.widgetOpacity,
              onChange: (e) => patch({ widgetOpacity: Number(e.target.value) })
            }
          ) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sidebar-title", style: { padding: "10px 0 0" }, children: "日历" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "每周起始日", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "segmented", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                className: settings.weekStartsOn === 1 ? "active" : "",
                onClick: () => patch({ weekStartsOn: 1 }),
                children: "周一"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                className: settings.weekStartsOn === 0 ? "active" : "",
                onClick: () => patch({ weekStartsOn: 0 }),
                children: "周日"
              }
            )
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "时间格式", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "segmented", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: settings.hour24 ? "active" : "", onClick: () => patch({ hour24: true }), children: "24 小时" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: !settings.hour24 ? "active" : "", onClick: () => patch({ hour24: false }), children: "12 小时" })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Row, { label: "数据", desc: "所有数据保存在本机，不上传", children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "btn", onClick: () => window.api.openDataFolder(), children: "打开数据文件夹" }) })
        ] })
      ] })
    }
  );
}
const VIEWS = [
  { key: "month", label: "月" },
  { key: "week", label: "周" },
  { key: "day", label: "日" }
];
function App() {
  const ready = useApp((s) => s.ready);
  const events = useApp((s) => s.events);
  const settings = useApp((s) => s.settings);
  const view = useApp((s) => s.view);
  const cursor = useApp((s) => s.cursor);
  const editing = useApp((s) => s.editing);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const quickAddOpen = useApp((s) => s.quickAddOpen);
  const toast = useApp((s) => s.toast);
  const init = useApp((s) => s.init);
  const setView = useApp((s) => s.setView);
  const setCursor = useApp((s) => s.setCursor);
  const step = useApp((s) => s.step);
  const goToday = useApp((s) => s.goToday);
  const openNew = useApp((s) => s.openNew);
  const openEdit = useApp((s) => s.openEdit);
  const closeEditor = useApp((s) => s.closeEditor);
  const saveEvent = useApp((s) => s.saveEvent);
  const removeEvent = useApp((s) => s.removeEvent);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const setQuickAddOpen = useApp((s) => s.setQuickAddOpen);
  reactExports.useEffect(() => {
    void init();
  }, [init]);
  reactExports.useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuickAddOpen(true);
        return;
      }
      if (typing || editing) return;
      switch (e.key) {
        case "n":
        case "N":
          e.preventDefault();
          openNew();
          break;
        case "t":
        case "T":
          e.preventDefault();
          goToday();
          break;
        case "1":
          setView("month");
          break;
        case "2":
          setView("week");
          break;
        case "3":
          setView("day");
          break;
        case "ArrowLeft":
          e.preventDefault();
          step(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          step(1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, goToday, openNew, setQuickAddOpen, setView, step]);
  const openDay = (d) => {
    setCursor(d);
    setView("day");
  };
  const dayEvents = reactExports.useMemo(
    () => view === "day" ? eventsOnDay(events, cursor) : [],
    [view, events, cursor]
  );
  if (!ready) {
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { display: "grid", placeItems: "center", height: "100vh", color: "#8b93a1" }, children: "加载中…" });
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "app-shell", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Sidebar,
      {
        events,
        cursor,
        weekStartsOn: settings.weekStartsOn,
        hour24: settings.hour24,
        onJump: openDay,
        onEdit: openEdit,
        onNew: () => openNew(),
        onOpenSettings: () => setSettingsOpen(true),
        onToggleWidget: () => void window.api.toggleWidget()
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { className: "main", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "toolbar", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "toolbar-title", children: viewTitle(cursor, view) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "nav-group", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn", onClick: () => step(-1), title: "上一页", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevronLeft", size: 14 }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "btn ghost", style: { height: 24 }, onClick: goToday, title: "回到今天 (T)", children: "今天" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "icon-btn", onClick: () => step(1), title: "下一页", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "chevronRight", size: 14 }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "spacer" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "segmented", children: VIEWS.map((v) => /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            className: view === v.key ? "active" : "",
            onClick: () => setView(v.key),
            title: `${v.label}视图 (${VIEWS.indexOf(v) + 1})`,
            children: v.label
          },
          v.key
        )) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "btn", onClick: () => setQuickAddOpen(true), title: "快速添加 (Ctrl+K)", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "clock", size: 13 }),
          "快速添加"
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "btn primary", onClick: () => openNew(), title: "新建日程 (N)", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "plus", size: 14, strokeWidth: 2.4 }),
          "新建"
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "view-area", children: [
        view === "month" && /* @__PURE__ */ jsxRuntimeExports.jsx(
          MonthView,
          {
            events,
            cursor,
            weekStartsOn: settings.weekStartsOn,
            hour24: settings.hour24,
            onNew: openNew,
            onEdit: openEdit,
            onOpenDay: openDay
          }
        ),
        view === "week" && /* @__PURE__ */ jsxRuntimeExports.jsx(
          TimeGrid,
          {
            events,
            days: weekDays(cursor, settings.weekStartsOn),
            hour24: settings.hour24,
            onNew: openNew,
            onEdit: openEdit,
            onOpenDay: openDay
          }
        ),
        view === "day" && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "day-layout", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            TimeGrid,
            {
              events,
              days: [startOfDay$1(cursor)],
              hour24: settings.hour24,
              bare: true,
              onNew: openNew,
              onEdit: openEdit,
              onOpenDay: openDay
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "day-panel", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { children: fmtDayLabel(cursor) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "muted", children: dayEvents.length === 0 ? "这一天还是空的。" : `共 ${dayEvents.length} 项安排` }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "detail-list", children: dayEvents.map((ev) => {
              const c = colorOf(ev.color);
              return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "detail-item", onClick: () => openEdit(ev), children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "detail-time", children: ev.allDay ? "全天" : fmtTime(new Date(ev.start), settings.hour24) }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { minWidth: 0, flex: 1 }, children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { style: { fontWeight: 550, wordBreak: "break-word" }, children: ev.title }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { style: { fontSize: 11.5, color: "var(--text-3)", marginTop: 1 }, children: [
                    ev.allDay ? "" : durationLabel(new Date(ev.start), new Date(ev.end)),
                    ev.notes ? ` · ${ev.notes.slice(0, 24)}` : ""
                  ] })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "span",
                  {
                    style: {
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: c.dot,
                      marginTop: 6,
                      flex: "none"
                    }
                  }
                )
              ] }, ev.id);
            }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                className: "btn",
                style: { marginTop: 14, width: "100%", justifyContent: "center" },
                onClick: () => openNew(startOfDay$1(cursor)),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "plus", size: 13 }),
                  "在这天新建"
                ]
              }
            )
          ] })
        ] })
      ] })
    ] }),
    editing && /* @__PURE__ */ jsxRuntimeExports.jsx(
      EventEditor,
      {
        draft: editing,
        onSave: saveEvent,
        onDelete: removeEvent,
        onClose: closeEditor
      }
    ),
    quickAddOpen && /* @__PURE__ */ jsxRuntimeExports.jsx(QuickAdd, {}),
    settingsOpen && /* @__PURE__ */ jsxRuntimeExports.jsx(SettingsPanel, {}),
    toast && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "toast", children: toast })
  ] });
}
client.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(React.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(App, {}) })
);
