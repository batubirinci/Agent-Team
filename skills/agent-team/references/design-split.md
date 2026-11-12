# Design → implement split for hard work

Default for hard work since 2026-11-10 (owner): **Fable designs, Opus/Sonnet implement.** Hard work
= geometry, numerical tolerances, coordinate transforms, selection semantics, a new product rule,
anything routed to the Opus Developer. When design and code keep evolving together (the method
only becomes clear while coding), the Lead says so in the brief and the Opus Developer may refine
the method inside the contract's limits — it still returns any change to a product rule,
tolerance, coordinate model or the core method as a design question.

1. **Analyst (`team-analyst-high`, Fable · high) — criteria + design contract.** Delivers the
   acceptance criteria and a short design contract, not a line-by-line recipe: goal, behavior to
   preserve, chosen method + why, numerical tolerances, likely files (not binding), open
   decisions. Its read-only spike tries to refute the assumptions the method rests on
   (counter-examples, boundary cases, tolerance behavior) and states what a small measurement does
   not prove. It gives the acceptance tests' expected values from an independent calculation or
   hand-checkable examples, with their source (the worst risk is one wrong assumption entering
   both the design and the tests).
2. **Developer — implement.** Usually the Opus Developer; a Sonnet Developer when the contract
   leaves only well-scoped implementation. Before coding it restates the method and open risks in
   a few bullets; disagreement is resolved then, not later. It first commits red acceptance tests
   with the contract's expected values (each proven red for the missing behavior, not setup or
   unrelated errors), then implements, and owns local implementation details. If a product rule,
   coordinate model, tolerance or the core method would have to change, it stops and returns a
   short design question at once — it does not wait for a failed fix round. Root-cause recurrence
   goes back through the Lead to the Analyst for a revised contract.
3. **Ownership of questions:** the Analyst owns "what counts as correct" and the method; the
   Developer owns the code and never silently changes the criteria or the method; a missing
   product decision goes to the owner via the Lead.
4. **QA also questions the tests:** a green suite does not clear wrong expected values or missing
   coverage — briefs ask QA to check the acceptance tests themselves.
5. **Pilot metrics include design-return overhead** (contract revisions, design questions) and the
   correctness problems QA found, per phase (`pilot.md`, P9).
