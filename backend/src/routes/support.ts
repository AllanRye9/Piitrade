import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../utils/prisma';
import { optionalAuthenticate, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { callLLMText } from '../lib/llm';

const router = Router();

// The exact fallback the moderation spec defines for "answer not in
// context" — reused verbatim here for every other reason there's no
// answer (LLM not configured, call failed, empty FAQ context) so a shopper
// never sees a different message depending on *why* the bot couldn't help,
// only that it couldn't.
const HUMAN_TRANSFER_FALLBACK = "I'm sorry, I cannot find that information. Let me transfer you to a human agent.";

const MAX_MESSAGE_LENGTH = 1000;

function buildSystemPrompt(faqContext: string): string {
  return `You are the official Customer Support AI for our e-commerce platform. Your goal is to resolve user inquiries politely, accurately, and concisely (under 3 sentences).

Strict Guardrails:
1. Base your answer ONLY on the provided "Platform Policy Context" section below.
2. If the user's question cannot be answered using the provided context, reply exactly with: "${HUMAN_TRANSFER_FALLBACK}"
3. Do not make up facts, urls, phone numbers, or platform policies.

Platform Policy Context:
${faqContext}`;
}

/**
 * POST /support/chat — { message: string }
 * optionalAuthenticate (not authenticate): the support widget is available
 * to logged-out visitors too, since "how do I sign up" / "is this site
 * legit" are exactly the questions a not-yet-registered visitor would ask.
 * req.user, when present, only decides the "User Account Status" line
 * handed to the LLM (see the spec's user-prompt template) — it never
 * changes which FAQ context the answer is grounded in.
 */
router.post('/chat', optionalAuthenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { message } = req.body as { message?: string };
    if (!message || typeof message !== 'string' || !message.trim()) {
      return next(createError('message is required', 400));
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return next(createError(`message must be ${MAX_MESSAGE_LENGTH} characters or fewer`, 400));
    }

    const config = await prisma.siteConfig.findUnique({ where: { id: 'global' } });
    const faqContext = config?.supportFaqContext?.trim();

    // Nothing to ground an answer in — always transfer, without spending an
    // LLM call to be told the same thing (also covers "LLM not configured"
    // implicitly, since callLLMText would return null anyway in that case).
    if (!faqContext) {
      res.json({ reply: HUMAN_TRANSFER_FALLBACK });
      return;
    }

    const accountStatus = req.user
      ? `logged in (${req.user.role.toLowerCase()})`
      : 'guest (not logged in)';
    const userPrompt = `User Account Status: ${accountStatus}\nUser Query: ${message.trim()}`;

    const reply = await callLLMText(buildSystemPrompt(faqContext), userPrompt);
    res.json({ reply: reply?.trim() || HUMAN_TRANSFER_FALLBACK });
  } catch (err) {
    next(err);
  }
});

export default router;
