// Edit PDF (B3): number input for the Edit panel.
import { useState } from "react";

/** A number box that applies on Enter or when it loses focus (not on every key). */
export function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onCommit(v: number): void;
}) {
  const [text, setText] = useState(String(props.value));
  const [shown, setShown] = useState(props.value);
  if (shown !== props.value) {
    setShown(props.value);
    setText(String(props.value));
  }
  const commit = () => {
    const v = Number(text);
    if (!text.trim() || !Number.isFinite(v) || v === props.value) {
      setText(String(props.value));
      return;
    }
    props.onCommit(Math.min(props.max, Math.max(props.min, v)));
  };
  return (
    <input
      type="number"
      aria-label={props.label}
      value={text}
      min={props.min}
      max={props.max}
      step={props.step}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}
