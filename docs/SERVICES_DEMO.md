# Connected services demonstration

This walkthrough demonstrates one design change flowing through room use, service connections, quantities, estimates and a reviewed construction programme. It is a residential concept coordination workflow, not an installation design or a certified estimate. All sample architectural and service prices and productivities are illustrative.

## Prepare and establish the baseline

1. Sign in with an editor or administrator account and create a **new empty project**. Use INR and the default demonstration calendar/settings for the recorded comparison below. Existing designs are never overwritten by the demo action.
2. Open **Services → Preview connected demo house**. Inspect both levels, four bedrooms, two bathrooms, room shells and the Electrical, Water and Drainage layers. This is a detached proposal: nothing has been added to the saved model yet. The example excludes the sample MEP allowance to avoid counting it alongside the new measured service scope. Other unmodelled scope remains unresolved.
3. Choose **Accept services proposal**. The house and concept services become one reversible transaction. Point loads, room-relative coordinates, hosts and conceptual circuit groups can now be edited. Socket/equipment loads initially remain unknown; proposed lights use a disclosed 12 W allowance.
4. Open **Quantities & estimates → Use illustrative demo rates**. Inspect the stated demo provenance, material/labour rates and installation output. Choose **Accept services proposal**. This action explicitly enters demonstration assumptions; it does not fetch Kerala market rates or supplier quotations.
5. Choose **Review construction scope**, then **Review model quantities** in Schedule. Review the proposed first construction template, source quantities, rough-in/fit-off dependencies, manual/proxy activities, crew availability and omissions. Choose **Accept reviewed activity scope**. The baseline completion date becomes usable as a preliminary result of these entered assumptions.

The demonstration house and service proposals are deterministic and run locally. The existing AI architectural copilot is separate and requires its configured provider connection when used. The services walkthrough does not represent a new live-provider request or demonstrate an AI-generated engineering design.

## Explore the bathroom change

6. Return to **Services → Coordinate**. Select **Upper bathroom** under **Bathroom to relocate** and **Study** under **Swap room function with**. Choose **Review bathroom relocation**.
7. Inspect the proposal card and its affected connections before accepting. The bathroom function and its three fixtures move into the existing Study shell; the original bathroom becomes Study. Four bedrooms remain. Six water/drainage connections change. Walls, doors and windows stay in place, and electrical points remain with their existing room hosts. Review privacy, circulation, room suitability, ventilation, wet-zone electrical separation, waterproofing and penetrations before treating this as a viable design.
8. Compare the quantities and service subtotal. Choose **Accept services proposal**, then use **Undo last transaction** and **Redo transaction** to show that the room uses, fixtures, connections and quantities revert and return together. Changing the house invalidates the earlier construction-scope review; a retained date is not a freshly approved programme.
9. Open **Review construction scope → Review model quantities** again. Review the updated service effort and retained planner assumptions, then **Accept reviewed activity scope**. Show the resulting preliminary programme.
10. Save and wait for the workspace's saved status. Reload the browser or fully quit and reopen the same desktop profile and confirm that the accepted model, services, rates and reviewed schedule return. Both browser reload and the installed macOS 0.6.0 app's full restart were verified for this demonstration.

## Recorded browser and native checkpoint

The following results were recorded on 24 October 2026 in browser QA and reproduced in the installed **Atelier 0.6.0 macOS arm64 app**, using a separate QA project/profile. The house contained **90 architectural elements, two levels, four bedrooms, 54 service points and 58 routes**. Explicit illustrative rates and the default calendar were used. These are fixture-specific arithmetic, not promised project costs, installation durations or survey accuracy. UI values may be rounded more coarsely.

| Measurement | Baseline | Upper bathroom ↔ Study |
|---|---:|---:|
| Modelled cold-water routes | 35.26 m | 62.61 m |
| Modelled drainage routes | 37.01 m | 64.36 m |
| All modelled service routes | 515.154 m | 569.842692 m |
| Known services subtotal | INR 179,964.27 | INR 193,909.90 |
| Services installation effort | 21.4687 crew-days | 23.0312 crew-days |
| Reviewed construction programme | 110 calendar / 95 working days | 113 calendar / 97 working days |
| Preliminary finish | 19 February 2027 | 22 February 2027 |

The native walkthrough completed proposal acceptance, illustrative rates, baseline scope review, bathroom ↔ Study acceptance, Undo, Redo and updated scope review. A full app restart retained the final **v8** project, service model, entered rates and reviewed programme. These recorded results verify the 0.6.0 services journey; they do not establish verification of subsequent navigation or command-palette changes. See [validation evidence](VALIDATION.md) for release-specific checks.

The services subtotal is separate from the whole-building estimate; it excludes unrepresented equipment, fittings, testing, taxes and specialist scope unless explicitly allowed in entered rates. Centreline route lengths include vertical segments and measure drawn branches individually; they do not establish conductor multiplicity, shared distribution sizing or procurement quantities. Crew-days express installation effort, while programme dates depend on reviewed activities, dependencies, working days, procurement and crew constraints. The example shows a cost/time consequence, not a savings claim or an optimum.

## Calculations and handoff

- **Calculation notebook:** enter connected point loads to explore single-phase current using voltage, power factor and demand factor. Unknown loads keep the result unknown. The drainage notebook calculates required fall from a route's projected horizontal run and a user-entered gradient. References and assumptions are visible; cable/breaker/earthing design, pipe capacity, invert feasibility and statutory checks are excluded.
- **Exports:** Services JSON retains the concept and review data; per-level SVG shows selected service layers and projected risers. Project JSON retains the full model and services. Review PDF and XLSX include service coordination, quantities, assumptions and the electrical-demand calculation. The drainage notebook is inspected in the app; its entered gradient is retained with the service assumptions. IFC remains architectural only, with no MEP IFC export claimed.
- **Pitch boundary:** the demonstrated value is a connected, editable decision workflow. No comparative advantage over Autodesk Forma, professional engineering accuracy or regulatory certification has been established by this fixture.
