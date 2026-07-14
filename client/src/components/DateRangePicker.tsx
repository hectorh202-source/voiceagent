export function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input type="date" value={from} onChange={(e) => onChange(e.target.value, to)} />
      <span className="muted">–</span>
      <input type="date" value={to} onChange={(e) => onChange(from, e.target.value)} />
    </span>
  );
}
