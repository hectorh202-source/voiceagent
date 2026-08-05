import axios from "axios";

// Microsoft retired the old one-click "Incoming Webhook" connector from the
// Teams connector gallery — getting a URL today means adding the Workflows
// app to a channel and building a flow from the "Post to a channel when a
// webhook request is received" template. That flow's own trigger defines
// whatever JSON schema it expects; there's no one universal fixed schema
// the way Slack's incoming webhooks have. We send a small, clearly-named
// JSON body (title/text/facts) so a workflow can map whichever fields it
// needs, but the exact shape has not been confirmed against a real Teams
// webhook — verify with one real message before relying on this.
export interface TeamsMessage {
  title: string;
  text: string;
  facts?: { name: string; value: string }[];
}

export async function sendTeamsMessage(webhookUrl: string, message: TeamsMessage): Promise<void> {
  await axios.post(
    webhookUrl,
    {
      title: message.title,
      text: message.text,
      facts: message.facts ?? [],
    },
    { headers: { "Content-Type": "application/json" } },
  );
}
