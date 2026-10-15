export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** "15 Oct 2026 13:04 UTC": readable for people and safe for the model to copy. */
export function utc(iso: unknown) {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${month} ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}

/**
 * Llama 3.3 on Workers AI sends each streamed chunk in two formats at once:
 * the native `response` / `tool_calls` fields and the OpenAI-style
 * `choices[0].delta`. workers-ai-provider emits both, so every token and tool
 * call shows up twice. This strips the native fields whenever `choices` is
 * present, leaving one copy.
 */
export function withDedupedStream(binding: Ai): Ai {
  const run = async (...args: Parameters<Ai["run"]>) => {
    const output = await binding.run(...args);
    if (!(output instanceof ReadableStream)) return output;

    const encoder = new TextEncoder();
    let buffer = "";
    const dedupeLine = (line: string) => {
      if (!line.startsWith("data: ") || line === "data: [DONE]") return line;
      try {
        const chunk = JSON.parse(line.slice(6));
        if (Array.isArray(chunk.choices)) {
          delete chunk.response;
          delete chunk.tool_calls;
        }
        return "data: " + JSON.stringify(chunk);
      } catch {
        return line;
      }
    };

    return output.pipeThrough(new TextDecoderStream()).pipeThrough(
      new TransformStream<string, Uint8Array>({
        transform(text, controller) {
          buffer += text;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            controller.enqueue(encoder.encode(dedupeLine(line) + "\n"));
          }
        },
        flush(controller) {
          if (buffer) controller.enqueue(encoder.encode(dedupeLine(buffer)));
        }
      })
    );
  };
  return new Proxy(binding, {
    get: (target, prop, receiver) =>
      prop === "run" ? run : Reflect.get(target, prop, receiver)
  });
}

export type ClaimFacts = {
  partner: string;
  site: string;
  shipments: string;
  exceptions: { id: number; type: string; detail: string; due_by: string }[];
};

/** Prompt for the claim email. The facts come from the database, not the chat. */
export function claimPrompt(f: ClaimFacts) {
  return `Write a short, professional claim email to ${f.partner} from the RMA desk at ${f.site}.

Facts (use only these; do not invent part numbers, serials, amounts or dates):
${f.exceptions.map((e) => `- Exception #${e.id} ${e.type}: ${e.detail} Response due by ${utc(e.due_by)}.`).join("\n")}
Shipments: ${f.shipments}

Ask for a replacement or credit for each item and a response by the earliest due time. Plain text only. Start with "Hello ${f.partner}," and sign off as "RMA Desk, ${f.site}". Output only the email body.`;
}

/** Prompt for root-cause hypotheses. Facts come from the analytics; the model only explains. */
export function hypothesisPrompt(
  problem: string,
  hits: number,
  context: unknown
) {
  return `You are a lean / Kaizen practitioner in data center logistics. A statistical root-cause scan found this signal:

${problem}

How the ${hits} affected shipments in this segment spread over other factors (hits, shipments, rate %):
${JSON.stringify(context, null, 1)}

Give 3 short root-cause hypotheses an operations team could test this week. For each: one line for the hypothesis, then "Check:" with one concrete way to confirm or rule it out using shipment data, a site visit or a partner question. Use only the facts above; do not invent numbers. Plain text, numbered 1-3, no preamble.`;
}

/** Prompt for the document-warehouse review. Rule findings come from code; the model adds context. */
export function docReviewPrompt(
  header: string,
  documents: string[],
  findings: { severity: string; message: string }[]
) {
  return `You are an air-freight documentation controller reviewing a shipment's document set before it moves to the next stage.

Shipment: ${header}

Discrepancies already found by automated rule checks (treat these as confirmed; do not repeat them):
${findings.length ? findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n") : "- none"}

Documents:
${documents.join("\n\n")}

Write three short sections in plain text:
1. Summary: one or two sentences on whether this set is ready, and what blocks it.
2. Other observations: anything the rule checks would not catch (vague goods descriptions, missing signatures, Incoterm or address inconsistencies, customs or dangerous-goods risks). Only state what the documents show; write "None" if nothing stands out.
3. Amendment request: bullet points the forwarder or broker should correct.
Do not invent numbers that are not in the documents.`;
}
