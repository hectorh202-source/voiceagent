import type { CallDetailViewModel } from "./callDetails";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const styles = `
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; background: #f5f5f7; }
  h1 { font-size: 1.3rem; }
  .card { background: #fff; border: 1px solid #e1e1e1; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: #666; margin: 0 0 12px; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .actions a, .actions button { display: inline-block; padding: 8px 14px; border: 1px solid #ccc; border-radius: 6px; background: #fff; color: #1a1a1a; text-decoration: none; font-size: 0.9rem; cursor: pointer; font-family: inherit; }
  .details-row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 0.9rem; }
  .details-row:last-child { border-bottom: none; }
  .details-label { color: #666; flex-shrink: 0; }
  audio { width: 100%; }
  .transcript { max-height: 400px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .turn { max-width: 70%; padding: 10px 14px; border-radius: 10px; font-size: 0.9rem; }
  .turn.agent { align-self: flex-start; background: #eee; }
  .turn.user { align-self: flex-end; background: #2563eb; color: #fff; }
  .turn-time { font-size: 0.7rem; opacity: 0.6; margin-bottom: 4px; }
  .conv-id { font-family: monospace; font-size: 0.85rem; word-break: break-all; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${styles}</style></head>
<body>${body}
<script>
function copyCallLink() {
  navigator.clipboard.writeText(window.location.href);
  alert('Call link copied to clipboard');
}
</script>
</body>
</html>`;
}

export function renderCallDetailPage(vm: CallDetailViewModel): string {
  const row = (label: string, valueHtml: string) =>
    `<div class="details-row"><span class="details-label">${escapeHtml(label)}</span><span>${valueHtml}</span></div>`;

  const transcriptHtml = vm.transcript.length
    ? vm.transcript
        .map(
          (t) => `
        <div class="turn ${t.role === "user" ? "user" : "agent"}">
          <div class="turn-time">${escapeHtml(t.timeLabel)}</div>
          ${escapeHtml(t.message)}
        </div>`,
        )
        .join("")
    : `<p>No transcript available yet.</p>`;

  const leadLink = vm.leadUrl
    ? `<a href="${escapeHtml(vm.leadUrl)}" target="_blank" rel="noopener">${escapeHtml(vm.leadId ?? "View Lead")}</a>`
    : "—";

  return page(
    `Call ${vm.conversationId}`,
    `
    <div class="card">
      <h2>Conversation ID</h2>
      <div class="conv-id">${escapeHtml(vm.conversationId)}</div>
    </div>

    <div class="card">
      <h2>Actions</h2>
      <div class="actions">
        ${vm.leadUrl ? `<a href="${escapeHtml(vm.leadUrl)}" target="_blank" rel="noopener">View Lead in ST</a>` : ""}
        <button onclick="copyCallLink()">Copy Call Link</button>
      </div>
    </div>

    <div class="card">
      <h2>Call Recording</h2>
      ${
        vm.hasAudio
          ? `<audio controls src="/calls/${encodeURIComponent(vm.conversationId)}/audio"></audio>`
          : `<p>No recording available.</p>`
      }
    </div>

    <div class="card">
      <h2>Call Details</h2>
      ${row("Call Time", escapeHtml(vm.callTime))}
      ${row("Company", escapeHtml(vm.company))}
      ${row("Name", escapeHtml(vm.customerName ?? "—"))}
      ${row("Phone", escapeHtml(vm.phone ?? "—"))}
      ${row("Address", escapeHtml(vm.address ?? "—"))}
      ${row("Email", escapeHtml(vm.email))}
      ${row("Property Type", escapeHtml(vm.propertyType))}
      ${row("Emergency", vm.isEmergency === null ? "—" : vm.isEmergency ? "Yes" : "No")}
      ${row("ST Lead", leadLink)}
      ${row("Is Transferred", vm.isTransferred ? "Yes" : "No")}
      ${row("Forwarded Phone Number", escapeHtml(vm.forwardedNumber ?? "—"))}
      ${row("Transfer Destination", escapeHtml(vm.transferDestination ?? "—"))}
    </div>

    <div class="card">
      <h2>Call Summary</h2>
      <p>${escapeHtml(vm.summary ?? "No summary available yet.")}</p>
    </div>

    <div class="card">
      <h2>Conversation Transcript</h2>
      <div class="transcript">${transcriptHtml}</div>
    </div>

    <div class="card">
      <h2>Call Ended Reason</h2>
      <p>${escapeHtml(vm.terminationReason ?? "Unknown")}</p>
    </div>
  `,
  );
}

export function renderCallNotFoundPage(conversationId: string): string {
  return page(
    "Call not found",
    `<div class="card">
      <h2>Not found</h2>
      <p>No call record found for conversation ID <code>${escapeHtml(conversationId)}</code>. It may not have been received yet, or the ID is incorrect.</p>
    </div>`,
  );
}
