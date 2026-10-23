// Properties bar (Phase 3): style of the selected annotation(s), or of the markup tool
// that is on when nothing is selected. Lock/unlock, delete, "Make default".
import { useEffect, useReducer, useState } from "react";
import { useAnnotation, useAnnotationCapability } from "@embedpdf/plugin-annotation/react";
import {
  PdfAnnotationBorderStyle,
  PdfAnnotationSubtype,
  type PdfAnnotationFlagName,
  type PdfAnnotationObject,
} from "@embedpdf/models";
import { useWorkbench } from "../../app/workbench";
import { markupToolLabel } from "../../markup/config";
import {
  BORDER_STYLES,
  CLOUD_INTENSITY,
  FONTS,
  FONT_SIZES,
  LINE_ENDINGS,
  OPACITIES,
  STROKE_WIDTHS,
  patchFromStyle,
  propsFor,
  styleOf,
  type MarkupProp,
} from "../../markup/properties";
import { Icon } from "../Icon";

const SHAPES = [
  PdfAnnotationSubtype.SQUARE,
  PdfAnnotationSubtype.CIRCLE,
  PdfAnnotationSubtype.POLYGON,
  PdfAnnotationSubtype.LINE,
  PdfAnnotationSubtype.POLYLINE,
];

function colorLabel(prop: MarkupProp, a: Pick<PdfAnnotationObject, "type">): string {
  if (prop === "fontColor") return "Text color";
  if (prop === "color") return "Fill color";
  if (a.type === PdfAnnotationSubtype.FREETEXT) return "Border color";
  return SHAPES.includes(a.type) ? "Line color" : "Color";
}

export function PropertiesBar({ documentId }: { documentId: string }) {
  const wb = useWorkbench();
  const { provides: scope, state } = useAnnotation(documentId);
  const { provides: cap } = useAnnotationCapability();
  // Tool defaults live in the plugin; re-render when they change.
  const [, toolsChanged] = useReducer((n: number) => n + 1, 0);
  useEffect(() => cap?.onToolsChange(() => toolsChanged()), [cap]);
  if (!scope || !cap) return null;

  const selected = state.selectedUids
    .map((uid) => state.byUid[uid]?.object)
    .filter((a): a is PdfAnnotationObject => a !== undefined);
  const toolId = state.activeToolId;
  const tool = toolId ? cap.getTool(toolId) : undefined;
  const subject: PdfAnnotationObject | undefined =
    selected[0] ?? (tool?.defaults as PdfAnnotationObject | undefined);
  if (!subject || subject.type === undefined) return null;

  const props = propsFor(subject);
  const locked = selected.some((a) => a.flags?.includes("locked"));
  const editable = !locked && !wb.busy;
  const values = subject as unknown as Record<string, unknown>;

  const apply = (patch: Partial<PdfAnnotationObject>) => {
    if (selected.length) {
      scope.updateAnnotations(
        selected
          .filter((a) => propsFor(a).length)
          .map((a) => ({ pageIndex: a.pageIndex, id: a.id, patch })),
      );
    } else if (toolId) cap.setToolDefaults(toolId, patch);
  };

  const toggleLock = () => {
    const lock = !locked;
    scope.updateAnnotations(
      selected.map((a) => {
        const rest = (a.flags ?? []).filter((f) => f !== "locked");
        const flags: PdfAnnotationFlagName[] = lock ? [...rest, "locked"] : rest;
        return { pageIndex: a.pageIndex, id: a.id, patch: { flags } };
      }),
    );
  };

  const makeDefault = () => {
    const id = selected[0] ? cap.findToolForAnnotation(selected[0])?.id : toolId;
    if (!id) return;
    const style = styleOf(subject);
    cap.setToolDefaults(id, patchFromStyle(style));
    wb.updateSettings({ markupDefaults: { ...wb.settings.markupDefaults, [id]: style } });
    wb.toast(`Saved as the default style for ${markupToolLabel(id) ?? "this tool"}.`);
  };

  const strokeStyle = values.strokeStyle as PdfAnnotationBorderStyle | undefined;
  return (
    <div
      className="props-bar"
      role="toolbar"
      aria-label="Markup properties"
      data-testid="props-bar"
    >
      <span className="props-title">
        {selected.length
          ? selected.length === 1
            ? (markupToolLabel(cap.findToolForAnnotation(subject)?.id) ?? "Annotation")
            : `${selected.length} annotations`
          : `${markupToolLabel(toolId) ?? tool?.name ?? ""} tool`}
      </span>
      {props.map((p) => {
        switch (p) {
          case "strokeColor":
          case "color":
          case "fontColor":
            return (
              <ColorPicker
                key={p}
                label={colorLabel(p, subject)}
                value={typeof values[p] === "string" ? (values[p] as string) : "transparent"}
                presets={wb.settings.markupColors}
                allowNone={p === "color"}
                disabled={!editable}
                onPick={(c) => apply({ [p]: c } as Partial<PdfAnnotationObject>)}
              />
            );
          case "opacity":
            return (
              <Choice
                key={p}
                label="Opacity"
                value={Number(values.opacity ?? 1)}
                options={OPACITIES.map((o) => ({ value: o, label: `${o * 100}%` }))}
                disabled={!editable}
                onPick={(v) => apply({ opacity: v })}
              />
            );
          case "strokeWidth":
            return (
              <Choice
                key={p}
                label={subject.type === PdfAnnotationSubtype.FREETEXT ? "Border width" : "Width"}
                value={Number(values.strokeWidth ?? 1)}
                options={[
                  ...(subject.type === PdfAnnotationSubtype.FREETEXT
                    ? [{ value: 0, label: "No border" }]
                    : []),
                  ...STROKE_WIDTHS.map((w) => ({ value: w, label: `${w} pt` })),
                ]}
                disabled={!editable}
                onPick={(v) => apply({ strokeWidth: v } as Partial<PdfAnnotationObject>)}
              />
            );
          case "strokeStyle": {
            const shape = [
              PdfAnnotationSubtype.SQUARE,
              PdfAnnotationSubtype.CIRCLE,
              PdfAnnotationSubtype.POLYGON,
            ].includes(subject.type);
            const options = BORDER_STYLES.filter(
              (b) => shape || b.value !== PdfAnnotationBorderStyle.CLOUDY,
            ).map((b) => ({ value: b.value, label: b.label }));
            return (
              <Choice
                key={p}
                label="Style"
                value={strokeStyle ?? PdfAnnotationBorderStyle.SOLID}
                options={options}
                disabled={!editable}
                onPick={(v) =>
                  apply({
                    strokeStyle: v,
                    ...(v === PdfAnnotationBorderStyle.DASHED ? { strokeDashArray: [3, 3] } : {}),
                    ...(shape
                      ? {
                          cloudyBorderIntensity:
                            v === PdfAnnotationBorderStyle.CLOUDY ? CLOUD_INTENSITY : 0,
                        }
                      : {}),
                  } as Partial<PdfAnnotationObject>)
                }
              />
            );
          }
          case "lineEndings": {
            const le = (values.lineEndings as { start: number; end: number } | undefined) ?? {
              start: 0,
              end: 0,
            };
            const options = LINE_ENDINGS.map((l) => ({ value: l.value, label: l.label }));
            return (
              <span key={p} className="props-group">
                <Choice
                  label="Start"
                  value={le.start}
                  options={options}
                  disabled={!editable}
                  onPick={(v) =>
                    apply({ lineEndings: { ...le, start: v } } as Partial<PdfAnnotationObject>)
                  }
                />
                <Choice
                  label="End"
                  value={le.end}
                  options={options}
                  disabled={!editable}
                  onPick={(v) =>
                    apply({ lineEndings: { ...le, end: v } } as Partial<PdfAnnotationObject>)
                  }
                />
              </span>
            );
          }
          case "lineEnding":
            return (
              <Choice
                key={p}
                label="Arrow"
                value={Number(values.lineEnding ?? 0)}
                options={LINE_ENDINGS.map((l) => ({ value: l.value, label: l.label }))}
                disabled={!editable}
                onPick={(v) => apply({ lineEnding: v } as Partial<PdfAnnotationObject>)}
              />
            );
          case "fontFamily":
            return (
              <Choice
                key={p}
                label="Font"
                value={Number(values.fontFamily ?? FONTS[0].value)}
                options={FONTS.map((f) => ({ value: f.value, label: f.label }))}
                disabled={!editable}
                onPick={(v) => apply({ fontFamily: v } as Partial<PdfAnnotationObject>)}
              />
            );
          case "fontSize":
            return (
              <Choice
                key={p}
                label="Size"
                value={Number(values.fontSize ?? 12)}
                options={FONT_SIZES.map((s) => ({ value: s, label: `${s} pt` }))}
                disabled={!editable}
                onPick={(v) => apply({ fontSize: v } as Partial<PdfAnnotationObject>)}
              />
            );
          default:
            return null;
        }
      })}
      <span className="grow" />
      {props.length > 0 && (
        <button
          type="button"
          className="tool"
          title="Make these properties the default for this tool"
          aria-label="Make default"
          disabled={!!wb.busy}
          onClick={makeDefault}
        >
          <Icon name="makeDefault" />
        </button>
      )}
      {selected.length > 0 && (
        <>
          <button
            type="button"
            className="tool"
            aria-pressed={locked}
            aria-label={locked ? "Unlock" : "Lock"}
            title={
              locked ? "Unlock (allow moving and editing)" : "Lock (prevent moving and editing)"
            }
            onClick={toggleLock}
          >
            <Icon name={locked ? "lock" : "unlock"} />
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Delete annotation"
            title="Delete (Del)"
            disabled={!editable}
            onClick={() =>
              scope.deleteAnnotations(selected.map((a) => ({ pageIndex: a.pageIndex, id: a.id })))
            }
          >
            <Icon name="trash" />
          </button>
        </>
      )}
    </div>
  );
}

function Choice<T extends number>({
  label,
  value,
  options,
  disabled,
  onPick,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  const known = options.some((o) => o.value === value);
  return (
    <label className="props-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => onPick(Number(e.target.value) as T)}
      >
        {!known && <option value={String(value)}>{String(value)}</option>}
        {options.map((o) => (
          <option key={o.value} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorPicker({
  label,
  value,
  presets,
  allowNone,
  disabled,
  onPick,
}: {
  label: string;
  value: string;
  presets: string[];
  allowNone: boolean;
  disabled: boolean;
  onPick: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const none = value === "transparent" || !value;
  const pick = (c: string) => {
    setOpen(false);
    onPick(c);
  };
  return (
    <span className="color-picker">
      <button
        type="button"
        className="color-button"
        aria-label={`${label}: ${none ? "none" : value}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className={`swatch${none ? " none" : ""}`}
          style={none ? {} : { background: value }}
        />
        <span className="color-caption">{label}</span>
      </button>
      {open && (
        <div
          className="color-popover"
          role="dialog"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <div className="swatches">
            {presets.map((c) => (
              <button
                key={c}
                type="button"
                className="swatch"
                style={{ background: c }}
                aria-label={c}
                aria-pressed={c.toLowerCase() === value.toLowerCase()}
                onClick={() => pick(c)}
              />
            ))}
            {allowNone && (
              <button
                type="button"
                className="swatch none"
                aria-label="No color"
                aria-pressed={none}
                onClick={() => pick("transparent")}
              />
            )}
          </div>
          <label className="custom-color">
            Other…{" "}
            <input
              type="color"
              aria-label={`${label}: other color`}
              value={none ? "#000000" : value}
              onChange={(e) => pick(e.target.value.toUpperCase())}
            />
          </label>
        </div>
      )}
    </span>
  );
}
