# OGP Context Files — Usage Guide

Save all four `.md` files to your local OGP project folder:
`/Users/[name]/Desktop/Blockchain Governance Tool/ogp/docs/context/`

---

## Which file goes with which conversation

### Every new OGP technical conversation
Always paste `OGP-master-context.md` first, before anything else.
It is the shared foundation for all technical work.

---

### New conversation: Phase 1 — Key Recovery
1. Paste `OGP-master-context.md`
2. Paste `OGP-phase1-context.md`
3. Start with: *"Let's begin Phase 1, Task 1a — locking down the burn authority governance rule."*

**Goal:** RevocationRegistry.sol created, HierarchicalIdentityVerifier updated, reissuance flow documented.

---

### New conversation: Phase 2 — PoC Data Layer
*(Start only after Phase 1 is complete)*
1. Paste `OGP-master-context.md`
2. Paste `OGP-phase2-context.md`
3. Start with: *"Phase 1 is complete. Let's begin Phase 2, Task 2a — creating the env.ts config file."*

**Goal:** USE_MOCK_DATA flag wired, 8 test citizens minted, full PoC demo runnable end-to-end.

---

### New conversation: Phase 3+ (Frontend)
*(Start only after Phase 2 is complete)*
Context document for this phase will be created at the end of Phase 2.
It will include the v4 portal design decisions, component architecture, and Expo scaffold spec.

---

### New conversation: Cost-Benefit Analysis
*(Standalone — start any time, no dependencies)*
1. Paste `OGP-cost-benefit-context.md` only — no master context needed
2. Start with: *"Let's build the OGP cost-benefit analysis. Begin with Denmark as the high-trust democracy case."*

**Goal:** Executive summary + full working document comparing OGP vs. current democratic infrastructure costs.

---

## Tracking conversations against the task checklist

The interactive task tracker (built in this conversation) is your progress dashboard.
Use it in this conversation only — mark tasks complete here as you finish them in other conversations.

To report back to the tracker conversation:
*"Phase 1 Task 1a is complete — burn authority governance rule documented. Marking it done."*

---

## File summary

| File | Size | Purpose |
|---|---|---|
| `OGP-master-context.md` | Full | Paste into every technical conversation |
| `OGP-phase1-context.md` | Focused | Phase 1 conversation only |
| `OGP-phase2-context.md` | Focused | Phase 2 conversation only |
| `OGP-cost-benefit-context.md` | Standalone | Cost-benefit conversation — no tech context needed |
| `OGP-conversation-guide.md` | This file | Usage reference |
