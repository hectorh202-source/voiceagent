import axios from "axios";

// Microsoft retired the old one-click "Incoming Webhook" connector from the
// Teams connector gallery — getting a URL today means adding the Workflows
// app to a channel and building a flow from the "Post to a channel when a
// webhook request is received" template, typically paired with a "Post
// adaptive card in a channel" action. That's what this builds: a real
// Adaptive Card (not the older, also-being-retired MessageCard/Connector
// Card format), wrapped in the standard `{ type: "message", attachments: [...] }`
// envelope both the classic Incoming Webhook and the Workflows-based
// "Post card in a channel" action expect for a card attachment. The exact
// field names/version below follow the public Adaptive Card schema, but
// this hasn't been confirmed against a real Teams channel — verify the
// card actually renders as expected on the first real send.
export interface TeamsMessage {
  title: string;
  text: string;
  facts?: { name: string; value: string }[];
}

interface AdaptiveCardElement {
  type: string;
  [key: string]: unknown;
}

function buildAdaptiveCard(message: TeamsMessage): Record<string, unknown> {
  const body: AdaptiveCardElement[] = [
    {
      type: "TextBlock",
      text: message.title,
      weight: "Bolder",
      size: "Medium",
      wrap: true,
    },
    {
      type: "TextBlock",
      // Adaptive Cards support a small Markdown subset in TextBlock text —
      // bold/italic/links — so the callers' existing "[label](url)" links
      // (built for the old plain-text body) still render as real links here
      // with no changes needed on their end.
      text: message.text,
      wrap: true,
    },
  ];

  if (message.facts && message.facts.length > 0) {
    body.push({
      type: "FactSet",
      // FactSet's real field name is "title", not "name" — TeamsMessage
      // keeps "name" for its own external shape (unchanged for callers in
      // db/inboundLeads.ts and webhooks/postCall.ts) and this is the one
      // place that translates it into what the Adaptive Card schema expects.
      facts: message.facts.map((f) => ({ title: f.name, value: f.value })),
    });
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
        },
      },
    ],
  };
}

export async function sendTeamsMessage(webhookUrl: string, message: TeamsMessage): Promise<void> {
  await axios.post(webhookUrl, buildAdaptiveCard(message), { headers: { "Content-Type": "application/json" } });
}
