"use client";

import { useState } from "react";
import type { Hours, Weekday } from "@/lib/campus";

export function WeekdayHours({ day, hours, regular }: { day: Weekday; hours?: Hours | null; regular: Hours }) {
  const [mode, setMode] = useState(hours === undefined ? "regular" : hours === null ? "closed" : "custom");
  return <fieldset className="weekday-hours">
    <legend>{day}</legend>
    <label className="field"><span className="sr-only">{day} schedule</span>
      <select name={day} value={mode} onChange={event => setMode(event.target.value)}>
        <option value="regular">Regular hours</option><option value="custom">Custom hours</option><option value="closed">Closed</option>
      </select></label>
    {mode === "custom" && <div className="form-grid">
      <label className="field">{day} opens<input name={day+"-opens"} type="time" defaultValue={hours?.opens ?? regular.opens} required /></label>
      <label className="field">{day} closes<input name={day+"-closes"} type="time" defaultValue={hours?.closes ?? regular.closes} required /></label>
    </div>}
  </fieldset>;
}
