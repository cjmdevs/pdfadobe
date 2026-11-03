// B7: static mockups of the main screen in three visual directions, light and dark.
// node scripts/ui-mockups.mjs -> docs/ui/mockups/index.html (open in a browser).
// Icons are the real Fluent set the app uses. Synthetic file names only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ICONS = join(import.meta.dirname, "..", "node_modules", "@fluentui", "svg-icons", "icons");
const icon = (n) =>
  readFileSync(join(ICONS, `${n}_20_regular.svg`), "utf8").replace(
    "<svg",
    '<svg aria-hidden="true" class="i"',
  );

const btn = (n, label, extra = "") =>
  `<button class="ib ${extra}" title="${label}" aria-label="${label}">${icon(n)}</button>`;
const lbtn = (n, label, menu = false, extra = "") =>
  `<button class="lb ${extra}">${icon(n)}<span>${label}</span>${menu ? `<span class="caret">${icon("chevron_down")}</span>` : ""}</button>`;

const main = `
<div class="tabs">
  <div class="tab active">${icon("document_copy")}<span>workpaper-a.pdf</span>${btn("dismiss", "Close", "xs")}</div>
  <div class="tab">${icon("document_copy")}<span>1040 review (synthetic).pdf</span>${btn("dismiss", "Close", "xs")}</div>
</div>
<div class="toolbar main-tb">
  <div class="grp">${btn("folder_open", "Open")}${btn("save", "Save")}${btn("print", "Print")}</div>
  <div class="grp">${btn("arrow_undo", "Undo")}${btn("arrow_redo", "Redo")}</div>
  <div class="grp">${btn("search", "Find")}</div>
  <div class="grp pager">${btn("chevron_left", "Previous page")}<input class="field num" value="1" aria-label="Page"><span class="muted">/ 3</span>${btn("chevron_right", "Next page")}</div>
  <div class="grp">${btn("zoom_out", "Zoom out")}<button class="field sel">105%${icon("chevron_down")}</button>${btn("zoom_in", "Zoom in")}${btn("page_fit", "Fit page")}${btn("arrow_autofit_width", "Fit width", "on")}</div>
  <span class="grow"></span>
  <div class="grp"><button class="field sel">Continuous${icon("chevron_down")}</button></div>
  <div class="grp">${btn("info", "Properties")}${btn("keyboard", "Shortcuts")}${btn("dark_theme", "Theme")}${btn("settings", "Settings")}${btn("wrench", "Tools pane", "on")}</div>
</div>
<div class="toolbar tool-tb">
  <span class="tool-title">${icon("checkmark_circle")}Workpaper Tools</span>
  <span class="vsep"></span>
  ${lbtn("checkmark_circle", "Tickmark", true, "on")}${lbtn("text_font", "Letters", true)}${lbtn("number_symbol", "Numbers", true)}${lbtn("checkmark", "Checks", true)}${lbtn("arrow_up_right", "Connector", true)}
  <span class="vsep"></span>
  ${lbtn("note", "Note")}${lbtn("calculator", "Calculator")}${lbtn("library", "Library")}${lbtn("arrow_export_ltr", "Export CSV")}
  <span class="grow"></span>
  <button class="btn">Close</button>
</div>
<div class="body">
  <nav class="rail">${btn("document_copy", "Pages", "on")}${btn("bookmark", "Bookmarks")}${btn("attach", "Attachments")}</nav>
  <aside class="side panel">
    <header class="ph"><h3>Pages</h3>${btn("dismiss", "Close", "xs")}</header>
    <div class="thumbs">
      ${[1, 2, 3].map((n) => `<figure class="thumb${n === 1 ? " sel" : ""}"><div class="mini"><i></i><i></i><i class="s"></i></div><figcaption>${n}</figcaption></figure>`).join("")}
    </div>
  </aside>
  <main class="doc">
    <div class="paper">
      <h4>Workpaper A — page 1 of 3</h4>
      <p class="sub">Synthetic test document. No client data.</p>
      <table>
        <tr><td>Cash — operating</td><td>12,480.00</td><td class="tm">✓</td></tr>
        <tr><td>Cash — payroll</td><td>3,215.50</td><td class="tm">✓</td></tr>
        <tr><td>Petty cash</td><td>250.00</td><td class="tm">ⓐ</td></tr>
        <tr class="tot"><td>Total cash</td><td>15,945.50</td><td class="tm">ƒ</td></tr>
      </table>
    </div>
  </main>
  <aside class="right panel">
    <header class="ph">${btn("arrow_left", "All tools", "xs")}<h3>Workpaper Tools</h3></header>
    <div class="seg"><button class="on">Stamp summary <b>4</b></button><button>Notes <b>0</b></button></div>
    <div class="row"><button class="field sel grow1">All types${icon("chevron_down")}</button><button class="field sel grow1">All authors${icon("chevron_down")}</button></div>
    <ul class="list">
      <li><span class="tm">✓</span><span>Tickmark: Agreed to bank</span><span class="muted">p. 1 ×2</span></li>
      <li><span class="tm">ⓐ</span><span>Letter a: Per petty cash count</span><span class="muted">p. 1</span></li>
      <li><span class="tm">ƒ</span><span>Footed</span><span class="muted">p. 1</span></li>
    </ul>
    <div class="row end"><button class="btn">Export to CSV…</button></div>
    <h5 class="sec">Redact options (sample form)</h5>
    <label class="chk"><input type="checkbox" checked> Social Security numbers</label>
    <label class="chk"><input type="checkbox" checked> EINs</label>
    <label class="chk"><input type="checkbox"> Phone numbers</label>
    <div class="formrow"><label>Fill colour</label><span class="swatch"></span></div>
    <div class="formrow"><label>Overlay text</label><input class="field" placeholder="e.g. Redacted"></div>
    <div class="row end"><button class="btn">Cancel</button><button class="btn primary">Apply redactions</button></div>
  </aside>
</div>
<div class="toast">${icon("checkmark_circle")} Saved workpaper-a.pdf</div>`;

const DIRECTIONS = [
  {
    id: "a",
    name: "A · Fluent (Windows 11)",
    blurb:
      "Looks like it belongs on Windows 11. Neutral greys, Fluent blue, 4 px corners, soft layering. Tool toolbar uses icon + label; selected things get a blue tint and a 3 px indicator. Safest choice, least surprising next to Office.",
  },
  {
    id: "b",
    name: "B · Ledger (workpaper)",
    blurb:
      "Warm paper neutrals and a deep green accent, like a workpaper binder. Square-ish 2 px corners, clear 1 px rules, small-caps section headings, tabular figures. Denser, so more fits at 1366×768.",
  },
  {
    id: "c",
    name: "C · Quiet focus",
    blurb:
      "Chrome steps back so the document leads. Panels are floating cards with soft elevation, 8 px corners, pill segmented controls, a calm indigo accent. Most modern, a little less dense.",
  },
];

const css = `
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font:13px/1.4 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:#555;color:#111}
.picker{position:fixed;top:0;left:0;right:0;height:44px;display:flex;gap:8px;align-items:center;padding:0 12px;background:#111;color:#eee;z-index:10;font-size:13px}
.picker button{background:#333;color:#eee;border:1px solid #555;border-radius:4px;padding:5px 10px;cursor:pointer;font:inherit}
.picker button.on{background:#eee;color:#111}
.picker .note{margin-left:auto;color:#aaa;max-width:760px;font-size:12px}
.stage{position:absolute;top:44px;left:0;right:0;bottom:0;overflow:auto;display:flex;justify-content:center;padding:16px}
.frame{width:1366px;height:768px;flex:none;position:relative;overflow:hidden;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);box-shadow:0 8px 40px rgb(0 0 0/.5)}
.i{width:20px;height:20px;fill:currentColor;flex:none}
.muted{color:var(--fg2)}
.grow{flex:1}
button{font:inherit;color:inherit}
/* shared structure */
.tabs{display:flex;align-items:flex-end;gap:2px;height:36px;padding:0 8px;background:var(--chrome2)}
.tab{display:flex;align-items:center;gap:6px;height:30px;padding:0 6px 0 10px;border-radius:var(--r) var(--r) 0 0;color:var(--fg2)}
.tab .i{width:16px;height:16px}
.tab.active{background:var(--chrome);color:var(--fg)}
.toolbar{display:flex;align-items:center;gap:var(--gap);padding:0 8px;background:var(--chrome);border-bottom:1px solid var(--line);flex:none}
.main-tb{height:44px}
.tool-tb{height:52px}
.grp{display:flex;align-items:center;gap:2px}
.grp+.grp{padding-left:var(--gap);border-left:1px solid var(--line)}
.ib{width:32px;height:32px;display:grid;place-items:center;border:0;background:transparent;border-radius:var(--r);cursor:pointer;color:var(--fg)}
.ib.xs{width:24px;height:24px}.ib.xs .i{width:16px;height:16px}
.ib:hover,.lb:hover{background:var(--hover)}
.ib.on,.lb.on{background:var(--sel);color:var(--accent-ink)}
.lb{display:flex;align-items:center;gap:6px;height:36px;padding:0 8px;border:0;background:transparent;border-radius:var(--r);cursor:pointer}
.lb .caret .i{width:12px;height:12px}
.tool-title{display:flex;align-items:center;gap:8px;font-weight:600;padding:0 4px}
.tool-title .i{color:var(--accent)}
.vsep{width:1px;height:24px;background:var(--line);margin:0 4px}
.field{height:28px;border:1px solid var(--fieldline);background:var(--field);border-radius:var(--r);padding:0 8px;color:var(--fg);font:inherit;display:inline-flex;align-items:center;gap:4px}
.field.num{width:44px;text-align:right}
.field.sel .i{width:14px;height:14px;margin-left:auto;color:var(--fg2)}
.btn{height:30px;padding:0 14px;border:1px solid var(--fieldline);background:var(--field);border-radius:var(--r);cursor:pointer}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.body{flex:1;display:flex;min-height:0}
.rail{width:44px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;background:var(--chrome);border-right:1px solid var(--line)}
.panel{background:var(--panel);display:flex;flex-direction:column;gap:8px;overflow:hidden}
.side{width:200px;border-right:1px solid var(--line)}
.right{width:300px;border-left:1px solid var(--line);padding-bottom:12px}
.ph{display:flex;align-items:center;gap:6px;height:40px;padding:0 8px 0 12px;border-bottom:1px solid var(--line)}
.ph h3{margin:0;font-size:14px;font-weight:600;flex:1}
.thumbs{display:flex;flex-direction:column;align-items:center;gap:12px;padding:12px}
.thumb{margin:0;display:flex;flex-direction:column;align-items:center;gap:4px;color:var(--fg2);font-size:12px}
.mini{width:110px;height:142px;background:#fff;border:1px solid #0002;padding:10px;display:flex;flex-direction:column;gap:5px}
.mini i{display:block;height:4px;background:#ccc;width:80%}.mini i.s{width:50%}
.thumb.sel .mini{outline:2px solid var(--accent);outline-offset:2px}
.thumb.sel figcaption{color:var(--accent);font-weight:600}
.doc{flex:1;background:var(--docbg);overflow:hidden;display:flex;justify-content:center;padding:24px}
.paper{width:640px;background:#fff;color:#111;padding:56px 64px;box-shadow:0 2px 10px rgb(0 0 0/.25);font-family:Arial,sans-serif}
.paper h4{margin:0 0 4px;font-size:16px}.paper .sub{margin:0 0 28px;font-size:12px;color:#444}
.paper table{border-collapse:collapse;width:100%;font-size:13px}
.paper td{padding:6px 4px;border-bottom:1px solid #ddd}.paper td:nth-child(2){text-align:right;font-variant-numeric:tabular-nums}
.paper tr.tot td{border-top:2px solid #111;font-weight:700;border-bottom:3px double #111}
.paper .tm,.list .tm{color:#c00;font-weight:700;width:24px;text-align:center}
.seg{display:flex;margin:4px 12px 0;border:1px solid var(--fieldline);border-radius:var(--r);overflow:hidden}
.seg button{flex:1;border:0;background:transparent;height:30px;cursor:pointer}
.seg button.on{background:var(--sel);color:var(--accent-ink);font-weight:600}
.seg b{font-weight:600;margin-left:4px;color:var(--fg2)}
.row{display:flex;gap:8px;padding:0 12px}.row.end{justify-content:flex-end}.grow1{flex:1}
.list{list-style:none;margin:0;padding:0 4px}
.list li{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:var(--r)}
.list li:hover{background:var(--hover)}
.list li span:nth-child(2){flex:1}
.sec{margin:8px 12px 0;padding-top:12px;border-top:1px solid var(--line);font-size:12px;font-weight:600;color:var(--fg2)}
.chk{display:flex;align-items:center;gap:8px;padding:0 12px}
.chk input{accent-color:var(--accent);width:16px;height:16px;margin:0}
.formrow{display:grid;grid-template-columns:100px 1fr;align-items:center;gap:8px;padding:0 12px}
.swatch{width:40px;height:24px;background:#000;border:1px solid var(--fieldline);border-radius:var(--r)}
.toast{position:absolute;right:316px;bottom:16px;display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r2);box-shadow:var(--elev);color:var(--fg)}
.toast .i{color:var(--ok)}
.focusdemo{outline:2px solid var(--focus);outline-offset:2px}

/* A: Fluent */
.dir-a{--r:4px;--r2:8px;--gap:6px;--elev:0 8px 16px rgb(0 0 0/.14),0 0 2px rgb(0 0 0/.12);
  --bg:#f3f3f3;--chrome:#fbfbfb;--chrome2:#ebebeb;--panel:#fbfbfb;--fg:#1a1a1a;--fg2:#5c5c5c;--line:#e0e0e0;--hover:#0000000a;--sel:#e8f1fb;--accent:#0f6cbd;--accent-ink:#0f548c;--on-accent:#fff;--field:#fff;--fieldline:#d1d1d1;--docbg:#e6e6e6;--focus:#000;--ok:#107c10}
.dir-a.dark{--bg:#202020;--chrome:#2b2b2b;--chrome2:#1c1c1c;--panel:#272727;--fg:#fff;--fg2:#c5c5c5;--line:#3d3d3d;--hover:#ffffff0f;--sel:#2b3a4a;--accent:#479ef5;--accent-ink:#9ccbff;--on-accent:#0a0a0a;--field:#2d2d2d;--fieldline:#4a4a4a;--docbg:#161616;--focus:#fff;--ok:#54b054}
.dir-a .ib.on,.dir-a .lb.on{box-shadow:inset 0 -3px 0 var(--accent)}
.dir-a .tab.active{box-shadow:inset 0 2px 0 var(--accent)}

/* B: Ledger */
.dir-b{--r:2px;--r2:3px;--gap:4px;--elev:0 2px 6px rgb(0 0 0/.18);
  --bg:#f1efe9;--chrome:#f8f7f3;--chrome2:#e7e4db;--panel:#fbfaf7;--fg:#1d2321;--fg2:#545b57;--line:#d8d4c8;--hover:#1d23210d;--sel:#dcebe5;--accent:#1f6f5c;--accent-ink:#164f42;--on-accent:#fff;--field:#fff;--fieldline:#bfb9aa;--docbg:#d9d5ca;--focus:#1f6f5c;--ok:#1f6f5c}
.dir-b.dark{--bg:#1a1b19;--chrome:#22231f;--chrome2:#161714;--panel:#1f201d;--fg:#ecebe5;--fg2:#b1b0a6;--line:#3a3b35;--hover:#ffffff0d;--sel:#21392f;--accent:#5bbf9f;--accent-ink:#8fdcc2;--on-accent:#0d1512;--field:#262722;--fieldline:#4a4b43;--docbg:#121310;--focus:#8fdcc2;--ok:#5bbf9f}
.dir-b{font-size:12.5px}
.dir-b .ph h3,.dir-b .sec,.dir-b .tool-title{font-variant:small-caps;letter-spacing:.04em;text-transform:lowercase;font-size:14px}
.dir-b .main-tb{height:40px}.dir-b .tool-tb{height:44px}
.dir-b .lb{flex-direction:column;gap:0;height:40px;font-size:11px;padding:2px 6px}
.dir-b .lb .caret{display:none}
.dir-b .grp+.grp{border-left:1px solid var(--line)}
.dir-b .list li{border-bottom:1px dotted var(--line);border-radius:0;font-variant-numeric:tabular-nums}
.dir-b .ib.on,.dir-b .lb.on{box-shadow:inset 0 0 0 1px var(--accent)}

/* C: Quiet focus */
.dir-c{--r:8px;--r2:12px;--gap:8px;--elev:0 10px 30px rgb(15 20 40/.16),0 1px 3px rgb(15 20 40/.1);
  --bg:#eceef2;--chrome:#eceef2;--chrome2:#e2e5eb;--panel:#fff;--fg:#171a21;--fg2:#5b6170;--line:#00000000;--hover:#171a210d;--sel:#e7e8fd;--accent:#4f46e5;--accent-ink:#3730a3;--on-accent:#fff;--field:#f4f5f8;--fieldline:#dadde4;--docbg:#eceef2;--focus:#4f46e5;--ok:#16a34a}
.dir-c.dark{--bg:#14161b;--chrome:#14161b;--chrome2:#0f1115;--panel:#1d2027;--fg:#eef0f5;--fg2:#a3a9b8;--line:#00000000;--hover:#ffffff10;--sel:#2b2d5a;--accent:#8b8cf8;--accent-ink:#c7c8ff;--on-accent:#12132a;--field:#252932;--fieldline:#363b47;--docbg:#14161b;--focus:#a5a6ff;--ok:#4ade80}
.dir-c .toolbar{border:0}
.dir-c .tool-tb{margin:0 12px 8px;border-radius:var(--r2);background:var(--panel);box-shadow:var(--elev);height:48px}
.dir-c .grp+.grp{border-left:0;padding-left:4px}
.dir-c .side,.dir-c .right{margin:0 12px 12px 0;border:0;border-radius:var(--r2);box-shadow:var(--elev)}
.dir-c .rail{border:0;background:transparent}
.dir-c .ph{border-bottom:1px solid var(--fieldline)}
.dir-c .sec{border-top:1px solid var(--fieldline)}
.dir-c .seg{border:0;background:var(--field);padding:3px;border-radius:999px}
.dir-c .seg button{border-radius:999px;height:26px}
.dir-c .seg button.on{background:var(--panel);box-shadow:0 1px 3px rgb(0 0 0/.15);color:var(--fg)}
.dir-c .btn{border-radius:999px}
.dir-c .doc{padding-top:8px}
.dir-c .tab.active{background:var(--panel);border-radius:var(--r) var(--r) 0 0}
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>B7 directions</title><style>${css}</style></head><body>
<div class="picker">
  ${DIRECTIONS.map((d, i) => `<button data-dir="${d.id}" class="${i ? "" : "on"}">${d.name}</button>`).join("")}
  <button id="theme">Dark</button>
  <span class="note" id="note">${DIRECTIONS[0].blurb}</span>
</div>
<div class="stage"><div class="frame dir-a" id="frame">${main}</div></div>
<script>
const D=${JSON.stringify(Object.fromEntries(DIRECTIONS.map((d) => [d.id, d.blurb])))};
const f=document.getElementById("frame"),t=document.getElementById("theme");
const q=new URLSearchParams(location.search);
function set(dir,dark){f.className="frame dir-"+dir+(dark?" dark":"");document.getElementById("note").textContent=D[dir];
document.querySelectorAll("[data-dir]").forEach(b=>b.classList.toggle("on",b.dataset.dir===dir));t.textContent=dark?"Light":"Dark";}
let dir=q.get("dir")||"a",dark=q.get("theme")==="dark";set(dir,dark);
document.querySelectorAll("[data-dir]").forEach(b=>b.onclick=()=>{dir=b.dataset.dir;set(dir,dark)});
t.onclick=()=>{dark=!dark;set(dir,dark)};
</script></body></html>`;

const out = join(import.meta.dirname, "..", "docs", "ui", "mockups");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "index.html"), html);
console.log(join(out, "index.html"));
