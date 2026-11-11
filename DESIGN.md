# DESIGN

## What It Is
**Minimi Search** is a time-aware web-search chat agent built on the design and memory philosophy of [Minimi](https://www.projectminimi.com/). Its core differentiator is that it understands *time*, *its own past answers*, and *what changed since*. The agent strictly complies with the **single model-callable tool rule (`web_search`)**: all temporal resolution, cross-session memory retrieval, and claim verification are deterministic architectural infrastructure executing *around* the model rather than fragile tool choices the model must decide to invoke.

**Live Deployed Application:** [https://minimi-search.vercel.app/](https://minimi-search.vercel.app/)

---

## How It Works

```
user message
    │
    ▼
[S0 Ingest]              Persist message, stamp Clock (UTC), load user tz
    │
    ▼
[S1 Temporal Resolve]    Deterministic parsing (chrono + luxon + ambiguity rules) ──► TemporalFrame (0ms LLM)
    │
    ├──────────────────► [S2 Recall Engine] (Parallel with S3)
    │                     Indexed hour-bucket window + Cloud SQLite FTS5 (Turso / @libsql) + VectorIndex (Cosine fallback) ──► RecallBundle
    ▼
[S3 Route + Plan]        Fast-path heuristic & router ──► Plan{intent, needsRecall, needsSearch}
    │
    ▼
[S4 Context Build]       Ordered prompt builder (identity ──► policy ──► now ──► temporal_frame ──► recalled_history)
    │
    ▼
[S5 Research Loop]       Bounded agent loop, parallel searches, authority & freshness ranking ──► Evidence Ledger (E1..En)
    │
    ▼
[S6 Synthesize]          Token-level SSE streaming; citation guard enforces valid evidence IDs
    │
    ▼
[S7 Post-Gate]           Numeric grounding check flags ungrounded prices/metrics via correction events
    │
    ▼
[S8 Persist & Async]     Persist assistant turn to Cloud SQLite; enqueue claim extraction & embedding jobs
```

---

## Key Decisions (and Why)

1. **Memory & Clocks Are Not Tools**:
   Giving the model tools for "clock" or "recall" wastes latency, burns tokens, and fails silently when models hallucinate tool invocations. Deterministic code solves time arithmetic and memory retrieval before synthesis, guaranteeing 100% reliability while respecting the single-tool constraint.
2. **Deterministic Temporal Resolver (Chrono + Luxon)**:
   Weekday arithmetic ("last Tuesday", "on Monday", "3 November", "since then") is calculated deterministically with timezone awareness and documented ambiguity resolution. The resolved date is surfaced to the user ("Interpreted *Monday* as Mon 9 Nov 2026").
3. **Claim Ledger & Delta Engine**:
   "Has anything changed since then?" is answered through a structured diff against dated, sourced ledger claims, not vague vibes. When changes occur, the ledger version-chains the claim (`supersedes`), preserving historical truth.
4. **Hour-Bucket UTC Indexing & Content Hashing**:
   Messages and derivatives store an indexed `hour_bucket = floor(created_at / 3600000)` enabling instant bucket-pruned scans before fine timezone filtering. A SHA-256 `content_hash` ensures unchanged records are never re-extracted or re-embedded.
5. **Two-Tier LLM Pipeline & Pre-Seeded Research**:
   Small models/heuristics handle routing and planning; the main model handles grounded synthesis. For multi-entity comparisons ("5 CRM tools"), queries fan out in parallel, drastically reducing time-to-first-token.
6. **Time-Travel Evaluation Harness**:
   An injectable `Clock` (`FixedClock`) and mutable search fixtures allow replaying historical scenarios ("user asked on 3 Nov, today is 10 Nov") deterministically without paying live API costs.
7. **Cloud SQLite Architecture (Turso / @libsql/client) for Serverless Deployment**:
   Originally prototyped with local disk-locked C++ bindings (`better-sqlite3`), we transitioned the entire storage layer to serverless **Cloud SQLite powered by Turso (`@libsql/client`)**. This architectural evolution decouples storage from local machine disk, allowing true stateless serverless execution on **Vercel** ([https://minimi-search.vercel.app/](https://minimi-search.vercel.app/)), zero native compilation dependencies across Node.js versions, distributed edge replication, and instantaneous sub-5ms in-memory (`:memory:`) execution for unit tests and local development.

---

## Considered and Rejected

| Approach | Verdict | Reason |
| :--- | :--- | :--- |
| **better-sqlite3 (Native C++)** | Rejected | Incompatible with stateless serverless execution (Vercel Functions / AWS Lambda) where disk writes are ephemeral and native C++ compilation frequently breaks across Node 22+ environments. Replaced with `@libsql/client` (Turso Cloud SQLite) for resilient HTTP-based SQLite persistence. |
| **LangChain / LangGraph** | Rejected | Heavy runtime overhead, opaque control flow, and unnecessary graph abstraction for a linear pipeline. |
| **Model-Native Search Only** | Rejected | Opaque, vendor lock-in, impossible to enforce date bounds or ranking heuristics. |
| **Extra Tools (e.g. `recall`, `fetch_page`)** | Rejected | Violates the single-tool constraint; increases model failure modes. |
| **External Heavy Vector DB (Pinecone, Chroma)** | Rejected | Unnecessary infrastructure overhead; embedded VectorIndex with cosine fallback keeps vector embeddings co-located in the same SQLite table. |
| **Prompt-Only Temporal Math** | Rejected | LLMs frequently err on weekday offsets and leap/DST boundaries. |

---

## Measured Benchmark Results

From automated evaluation suite (`evals/reports/latest.md`):

| Metric | Target | Measured Value | Status |
| :--- | :--- | :--- | :--- |
| **Temporal Resolution Accuracy** | ≥ 90% | **100%** (108 unit tests + eval scenarios) | ✅ PASS |
| **Fabricated-Memory Honesty** | 0 cases | **0 cases** (Honest on empty windows) | ✅ PASS |
| **Citation Validity Rate** | ≥ 95% | **100%** (Enforced by citation guard) | ✅ PASS |
| **Numeric Grounding Rate** | ≥ 95% | **100%** (Unverified numbers flagged) | ✅ PASS |
| **TTFT (p50)** | < 700 ms (no-search) | **< 150 ms** (local echo) / **< 850 ms** (full pipeline) | ✅ PASS |
| **Acceptance Scenarios (A1–A6)** | 100% | **6/6 passed** | ✅ PASS |

---

## Known Weaknesses & Tradeoffs

1. **Entity Coreference on Short Messages**: Very terse follow-up messages ("and what about the second one?") rely on recent thread context rather than deep multi-turn coreference resolution.
2. **Single-Search Depth Default**: To optimize latency, default queries use `depth: 'quick'`; exhaustive multi-source consensus requires selecting `depth: 'deep'`.
3. **Static Aggregator Penalties**: Aggregator domain filtering uses curated domain rules rather than a learned authority classifier.

---

## With Another Week

1. **Scheduled Watchers**: Background crons monitoring pricing/changelog URLs of active claims so delta queries answer in < 500 ms from fresh ledger state.
2. **Model Context Protocol (MCP)**: Expose Chronos's memory and claim ledger over MCP so other developer agents can query its time-aware memory layer.
3. **HNSW Vector Expansion**: Transition the `VectorIndex` interface from brute-force cosine to HNSW graphs once thread archives exceed 100,000 vectors.
4. **Learned Intent Router**: Replace rule heuristics with fine-tuned fast router trained on eval logs.

