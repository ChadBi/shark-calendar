import { r as reactExports, D as DEFAULT_SETTINGS, e as eventsOnDay, j as jsxRuntimeExports, p as fmtDayLabel, I as Icon, b as colorOf, f as fmtTime, q as client, R as React } from "./Icon-DXWr2KAp.js";
const EXPANDED_H = 440;
const COLLAPSED_H = 56;
function Widget() {
  const [data, setData] = reactExports.useState(null);
  const [collapsed, setCollapsed] = reactExports.useState(false);
  reactExports.useEffect(() => {
    void window.api.getData().then(setData);
    const off = window.api.onDataChanged(setData);
    return off;
  }, []);
  reactExports.useEffect(() => {
    void window.api.setWidgetHeight(collapsed ? COLLAPSED_H : EXPANDED_H);
  }, [collapsed]);
  const settings = data?.settings ?? DEFAULT_SETTINGS;
  const events = data?.events ?? [];
  const todays = reactExports.useMemo(() => eventsOnDay(events, /* @__PURE__ */ new Date()), [events]);
  const now = Date.now();
  const ongoing = todays.filter(
    (e) => new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now
  );
  const alpha = settings.widgetOpacity;
  const openMain = () => void window.api.openMain();
  const hide = () => void window.api.toggleWidget(false);
  return /* @__PURE__ */ jsxRuntimeExports.jsxs(
    "div",
    {
      className: "wg",
      style: {
        ["--wg-alpha"]: String(alpha)
      },
      children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "wg-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "wg-date", onDoubleClick: openMain, title: "双击打开日程", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "wg-day", children: fmtDayLabel(/* @__PURE__ */ new Date()) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "wg-count", children: todays.length === 0 ? "今天空闲" : ongoing.length > 0 ? `今天 ${todays.length} 项 · 进行中 ${ongoing.length}` : `今天 ${todays.length} 项` })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "wg-actions", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                className: `wg-btn${settings.widgetAlwaysOnTop ? " active" : ""}`,
                onClick: () => void window.api.setWidgetPinned(!settings.widgetAlwaysOnTop),
                title: settings.widgetAlwaysOnTop ? "取消置顶（当前会遮挡其他窗口）" : "置顶显示",
                children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "pin", size: 12 })
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "wg-btn", onClick: () => setCollapsed((v) => !v), title: collapsed ? "展开" : "收起", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: collapsed ? "chevronLeft" : "chevronRight", size: 13 }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "wg-btn", onClick: openMain, title: "打开日程", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "calendar", size: 13 }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "wg-btn", onClick: hide, title: "隐藏悬浮窗", children: /* @__PURE__ */ jsxRuntimeExports.jsx(Icon, { name: "x", size: 13 }) })
          ] })
        ] }),
        !collapsed && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "wg-list", children: [
            todays.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "wg-empty", children: [
              "今天没有安排",
              /* @__PURE__ */ jsxRuntimeExports.jsx("br", {}),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "在应用里按 Ctrl+K 快速记一条" })
            ] }),
            todays.map((ev) => {
              const c = colorOf(ev.color);
              const past = new Date(ev.end).getTime() < now;
              const live = new Date(ev.start).getTime() <= now && new Date(ev.end).getTime() > now;
              return /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "div",
                {
                  className: `wg-item${past ? " past" : ""}${live ? " live" : ""}`,
                  onClick: () => void window.api.openEvent(ev.id),
                  title: ev.title,
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "wg-bar", style: { background: c.dot } }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "wg-time", children: ev.allDay ? "全天" : fmtTime(new Date(ev.start), settings.hour24) }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "wg-title", children: ev.title }),
                    live && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "wg-live-dot", style: { background: c.dot } })
                  ]
                },
                ev.id
              );
            })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "wg-foot", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "wg-hint", children: "拖动标题栏可移动 · 双击打开" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "wg-open", onClick: openMain, children: "打开日程" })
          ] })
        ] })
      ]
    }
  );
}
client.createRoot(document.getElementById("root")).render(
  /* @__PURE__ */ jsxRuntimeExports.jsx(React.StrictMode, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(Widget, {}) })
);
