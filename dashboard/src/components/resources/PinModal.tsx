"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { usePrefs } from "@/components/live/PrefsProvider";

// The dashboard's categorical hues: distinct from each other and readable as a tint behind text
export const PIN_COLORS = [
  { name: "Blue", value: "#2a78d6" },
  { name: "Orange", value: "#eb6834" },
  { name: "Aqua", value: "#1baf7a" },
  { name: "Yellow", value: "#eda100" },
  { name: "Magenta", value: "#e87ba4" },
  { name: "Green", value: "#008300" },
  { name: "Violet", value: "#4a3aa7" },
  { name: "Red", value: "#e34948" },
];

type Props = { name: string; label: string; onClose: () => void };

/** Pin a resource to the top of the list, highlighted in a color of the player's choice. */
export function PinModal({ name, label, onClose }: Props) {
  const { pins, setPin, removePin } = usePrefs();
  const current = pins[name];
  const [color, setColor] = useState(current ?? PIN_COLORS[0].value);

  return (
    <Modal open onClose={onClose} label={`Pin ${label}`} size="sm">
      <div className="modal-head">
        <h2 className="modal-title">{current ? "Pinned resource" : "Pin resource"}</h2>
        <p className="modal-sub">Pinned resources stay at the top of the list, highlighted in your color.</p>
      </div>

      <div className="pin-preview" style={{ ["--pin" as string]: color }}>
        <span className="pin-dot" aria-hidden />
        <strong>{label}</strong>
        <span className="muted">preview</span>
      </div>

      <fieldset className="swatches">
        <legend className="field-label">Highlight color</legend>
        {PIN_COLORS.map((c) => (
          <label key={c.value} className="swatch-option" title={c.name}>
            <input type="radio" name="pin-color" value={c.value} checked={color === c.value} onChange={() => setColor(c.value)} />
            <span className="swatch-chip" style={{ background: c.value }} />
            <span className="sr-only">{c.name}</span>
          </label>
        ))}
        <label className="swatch-option custom" title="Custom color">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Custom color" />
          <span className="field-hint">Custom</span>
        </label>
      </fieldset>

      <div className="modal-actions">
        {current && (
          <button type="button" className="btn btn-quiet danger" onClick={() => { removePin(name); onClose(); }}>
            Unpin
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" data-autofocus onClick={() => { setPin(name, color); onClose(); }}>
          {current ? "Save color" : "Pin to top"}
        </button>
      </div>
    </Modal>
  );
}
