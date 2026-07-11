# Project Guidelines

**Always commit changes** after completing work unless explicitly told not to.

## Testing Standards

**Jest clears all mocks automatically** (`clearMocks: true` in jest.config.ts). Never manually clear mocks.

**Mock state:** Set shared defaults in `beforeAll`. Override per-test with `mockReturnValueOnce` / `mockResolvedValueOnce` / `mockRejectedValueOnce`. Never use `beforeEach` — write a named `setup()` function if repeated arrangement is needed and call it explicitly.

**Non-determinism:** Any function that uses `Date.now()`, `Math.random()`, or `crypto.randomUUID()` to produce a value that affects test outcomes MUST accept it as an injectable parameter with a default:

```ts
// source
export const createThing = (input: Input, now = Date.now): Thing => ({ ...input, createdAt: now() })

// test
it('sets createdAt', () => {
  expect(createThing(input, () => 1_000_000).createdAt).toBe(1_000_000)
})
```

**Fake timers:** Use `jest.useFakeTimers()` in `beforeAll` (and `jest.useRealTimers()` in `afterAll`) when the code under test calls `setTimeout`, `setInterval`, or `Date` internally without injection.

**No `if` statements in tests.** No live `Date.now()` or `Math.random()` calls in test bodies. No date arithmetic that depends on the current wall-clock time.

**Deterministic above all.** A test that passes today and fails tomorrow is broken.

## Security

**Validate all external inputs** at API boundaries — schema, type, and length — before passing to downstream services or LLMs.

**Prompt injection** — user-supplied text embedded in LLM system prompts is an attack surface. XML-escape `<`/`>` before injecting into XML-structured prompts. Keep user content in user-role turns rather than system prompts wherever possible. Pre-validate input for injection-like patterns before forwarding to the model.

**LLM output is untrusted.** Always parse and validate model responses against the expected schema. Never execute or eval model output.

**Bearer tokens** (session IDs, API keys) are often the sole access control in Lambda APIs. Always generate with `crypto.randomInt` (CSPRNG), never `Math.random()`.

**OWASP Top 10.** Primary exposure for Lambda APIs: A01 Broken Access Control (token-as-sole-auth), A03 Injection (prompt injection for LLM apps; NoSQL injection for DynamoDB), A05 Security Misconfiguration (IAM — avoid `Resource: "*"` and unnecessary actions; scope to specific ARNs).
