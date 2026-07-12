import { getAgentTimezone, getDashboardBaseUrl } from "../settings/store";
import { formatPhoneNumber } from "../lib/format";

// Builds the text that becomes the ServiceTitan Lead's `summary` field —
// ServiceTitan carries this over into the Job's Summary field once staff
// convert the lead, so this is effectively the Job Summary too. Structured
// as labeled lines (date, narrative, phone, address, a link back to this
// call's detail page) rather than one terse sentence, so staff reviewing/
// converting the lead get the full call context without digging through
// ElevenLabs' own dashboard.
//
// `narrative` is supplied by the caller rather than computed here, since it
// has two different sources depending on when this is called: a short
// sentence built from structured call fields at lead-creation time (mid-call,
// before the real call summary exists), and the full AI-generated call
// summary once the post-call webhook delivers it — see webhooks/postCall.ts.
export function buildLeadSummary(
  businessId: number,
  input: {
    narrative: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    email?: string | null;
    conversationId?: string;
  },
): string {
  const address = `${input.street}, ${input.city}, ${input.state} ${input.zip}`;
  const now = new Date().toLocaleString("en-US", { timeZone: getAgentTimezone(businessId) });

  // Only populated when an existing ServiceTitan customer already has an
  // email on file (see lookupCustomerByPhone) — we never ask the caller for
  // one during the call, so a new customer simply won't have this line.
  const emailLine = input.email ? `\n\n- Email: ${input.email}` : "";

  // ServiceTitan's summary field doesn't auto-linkify plain URLs, so this
  // needs to actually be an anchor tag to render as clickable — a bare URL
  // just shows as inert text.
  const callDetailsLine = input.conversationId
    ? (() => {
        const url = `${getDashboardBaseUrl(businessId)}/b/${businessId}/calls/${input.conversationId}`;
        return `\n\n- Call Details: <a href="${url}">${url}</a>`;
      })()
    : "";

  return (
    `- Date: ${now}\n\n` +
    `${input.narrative}\n\n` +
    `- Phone: ${formatPhoneNumber(input.phone)}\n\n` +
    `- Address: ${address}` +
    emailLine +
    callDetailsLine +
    `\n\n- Call Taker: AI Agent`
  );
}

// Builds the short constructed narrative used at lead-creation time (mid-
// call, before the real AI-generated call summary exists) — kept separate
// from buildLeadSummary so it's clear this is only one of two possible
// narrative sources, not something buildLeadSummary computes itself.
export function buildInitialNarrative(input: {
  issueDescription: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  preferredTiming?: string;
  isEmergency: boolean;
}): string {
  const address = `${input.street}, ${input.city}, ${input.state} ${input.zip}`;
  return `${input.issueDescription} at ${address}.${
    input.preferredTiming ? ` Preferred timing: ${input.preferredTiming}.` : ""
  }${input.isEmergency ? " Customer indicated this is an emergency." : ""}`;
}
