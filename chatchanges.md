# Hermes Life — Chat Interface Upgrade Requirements

The goal is to transform the existing Hermes Life chat into a **visually structured AI development interface** where users can immediately distinguish Hermesha's thoughts from her final responses, read technical information comfortably, switch AI providers/models, and monitor context consumption and account usage.

These changes should build upon the existing chat system rather than replace its conversation history, task execution, or streaming functionality.

# 1. HL-CHAT-003 — Advanced Typography & Response Distinction

## 1.1 Current problem

The existing chat displays lengthy technical messages in a relatively uniform style.

Although Markdown formatting was introduced, the screenshots show several remaining issues:

- Text is too small and lacks sufficient contrast against the dark background.
- Large responses resemble technical documents pasted into the conversation.
- Headings and body text don't have enough visual hierarchy.
- Explanations, intermediate commentary, and final results look too similar.
- There is insufficient spacing between paragraphs and technical sections.
- The interface does not clearly identify whether Hermesha is explaining an ongoing operation or delivering her completed response.
- Italics, color, font weight, and other typography features aren't used effectively to communicate different message types.

**Desired result:** A conversation where the type and importance of information can be recognized immediately without reading the entire message.

## 1.2 Two visually distinct message types

The chat should distinguish between two primary types of Hermesha output.

### 💭 Hermesha's Thoughts

**Purpose:** Display Hermesha's observable analysis, progress commentary, and execution narration.

This includes information such as:

- What Hermesha is currently investigating.
- What problem or behavior she has identified.
- Which approach she is evaluating.
- Why she is making an observable implementation decision.
- What tool she is about to use.
- What a completed operation revealed.
- What she intends to do next.

**Visual appearance**

| Property | Specification |
|---|---|
| Label | 💭 Hermesha's Thoughts |
| Label color | Soft violet (`#C4A7FF`) |
| Body text color | Muted lavender (`#C9B8E8`) |
| Font style | Italic |
| Font size | 15–16 px |
| Line height | 1.65 |
| Font weight | 400 |
| Background | Subtle purple-tinted dark panel |
| Left border | 3 px violet accent |
| Paragraph spacing | 12–14 px |
| Corners | 10–12 px radius |

The label should be displayed at the top of the section and remain visually distinct from the content below it.

**Example appearance:**

> 💭 **Hermesha's Thoughts**
>
> *The existing implementation appears to process tool events correctly, but the display layer is replacing the detailed activity with a generic status.*
>
> *I'll inspect the event mapping and determine whether the complete text is preserved before changing the presentation logic.*

This is not intended to expose private internal model reasoning.

The section should only contain **actual, explicitly available, user-visible commentary or execution narration** emitted by Hermes. If the runtime doesn't provide such information, the interface must not fabricate it.

### ✨ Hermesha's Response

**Purpose:** Present Hermesha's final answer, conclusions, instructions, reports, or completed results.

This is the authoritative response that users should read after Hermesha finishes processing their request.

**Visual appearance**

| Property | Specification |
|---|---|
| Label | ✨ Hermesha's Response |
| Label color | Bright mint (`#82F0D0`) |
| Body text color | High-contrast off-white (`#EAF6F5`) |
| Font style | Normal |
| Font size | 16–17 px |
| Line height | 1.7 |
| Font weight | 400–450 |
| Background | Deep blue/teal |
| Accent border | Mint-green |
| Paragraph spacing | 14–16 px |
| Corners | 10–12 px radius |

The final response should carry greater visual prominence than the thoughts section.

**Example appearance:**

> ✨ **Hermesha's Response**
>
> ## Root Cause Identified
>
> The World view receives the correct runtime events, but its status renderer replaces detailed activity with generic tool labels.
>
> ### Recommended Fix
>
> Preserve the existing execution-event pipeline and connect its detailed activity representation to the resident interface.
>
> **Files affected:** `town-model.ts`, `town-view.ts`

### 1.3 How thoughts and responses should appear together

When Hermesha performs a longer task, the conversation should preserve the chronological relationship between her commentary and eventual response.

For example:

**USER**

Investigate why the model selector isn't working.

---

💭 **Hermesha's Thoughts**

*The frontend reports that the model catalog is unavailable. I'll first verify whether the backend provides the expected endpoint.*

*The route appears to exist, but the request isn't reaching the correct service. I'll check the API configuration.*

---

✨ **Hermesha's Response**

### Model Selector — Root Cause

The frontend is requesting a model catalog that the active backend isn't successfully serving.

**Resolution:** Correct the backend routing and verify the available provider configuration.

**Result:** Model discovery is functioning.

---

### Required behavior

The message types must remain distinct throughout execution.

When Hermesha produces another commentary update, it should update or create an appropriate thoughts section.

When she delivers the final response, it should appear in a separate response section.

The application must not automatically treat all streamed text as thoughts merely because it arrives before task completion.

Classification must be based on the actual event type or an explicit runtime-provided distinction.

If the runtime only provides ordinary assistant text and a final result, the interface should display them as response content rather than inventing a separate reasoning stream.

## 1.4 Typography hierarchy

Both message types should support rich Markdown, but use different presentation styles.

| Element | Thoughts | Response |
|---|---|---|
| Body text | Lavender, italic, 15–16 px | Off-white, normal, 16–17 px |
| Main heading | Violet, semibold | Mint, bold |
| Secondary heading | Muted violet | Pale cyan |
| Bold text | Brighter lavender | Bright white |
| Inline code | Lavender-tinted background | Teal/blue code background |
| Code blocks | Standard readable code panel | Standard readable code panel |
| Links | Soft violet | Cyan |
| Lists | Violet markers | Mint markers |
| Quotes | Violet-accented | Cyan-accented |

Code blocks should remain non-italicized in both sections so programming syntax stays readable.

### Message width and spacing

The assistant's messages should use most of the available chat width without becoming excessively wide.

The target is approximately 75–90 characters per line for ordinary body text on large displays.

Paragraphs should have sufficient separation, and long responses should use clear section headings.

The chat panel should remain resizable, with text reflowing naturally.

## 1.5 Additional formatting improvements

**Code blocks**

Include syntax highlighting, language labels, horizontal scrolling where required, and Copy buttons.

**Tables**

Render proper tables with visible row separation and horizontal scrolling on narrow screens.

**Long responses**

Support collapsible major sections where appropriate, without automatically hiding important conclusions.

**Copy behavior**

Copying a response should preserve its original Markdown content rather than copying decorative labels or UI elements.

**Streaming**

Markdown should render progressively without excessive flickering, duplicate text, broken code blocks, or scrolling disruptions.

---

# 2. HL-CHAT-004 — Provider Selection, Context Meter & Usage Monitoring

## 2.1 Current problem

The screenshots show the following status information:

`Provider: Default`  
`Model: Worker default`  
`Model catalog unavailable`  
`Cost: unavailable`  
`Balance: unavailable`

This indicates that the frontend has some controls for model selection and usage reporting, but it does not currently have the information needed to make them operational.

Additionally, the current horizontal arrangement makes all this information difficult to read.

**Desired result:** A compact but functional model-management interface showing the selected provider, active model, remaining context capacity, token usage, and available billing information.

## 2.2 Provider selection

The chat header should include a provider dropdown.

Example:

**Provider:** `OpenRouter ▾`

Selecting the dropdown should show the AI providers currently configured and usable by the Hermes runtime.

Potential providers include OpenRouter, OpenAI, Anthropic, and local OpenAI-compatible endpoints.

The list should be derived from real configuration rather than hardcoded examples.

### Required behavior

When a provider is selected:

1. The interface retrieves the provider's available models.
2. The model dropdown updates.
3. The currently selected model's context capacity becomes available.
4. Pricing information updates where supported.
5. Balance information updates where the provider supports it.
6. The selection is saved for subsequent messages in that conversation.

Changing providers must not interrupt a currently running task.

Any change should apply to the next execution.

## 2.3 Model selection

The model dropdown should be placed beside or below the provider dropdown.

**Model:** `DeepSeek V3.2 ▾`

Each model entry should ideally show:

| Property | Example |
|---|---|
| Model name | DeepSeek V3.2 |
| Provider | OpenRouter |
| Context window | 128K tokens |
| Input price | Price per million tokens |
| Output price | Price per million tokens |
| Tool calling | Supported |
| Availability | Available |

Model details must come from verified model metadata or runtime configuration.

### Model selection rules

- Selection should persist for the current conversation.
- Different conversations may use different models.
- The actual provider/model should be recorded for every task.
- Switching models must preserve conversation history.
- A previous task must continue showing the model that executed it.
- Background autonomous tasks should not automatically inherit changes made in Chat.
- Unsupported model/provider combinations must be rejected before execution.

---

## 2.4 Context window meter

The context meter should show how much of the selected model's context window is currently occupied.

### Compact display

**Context: 42.8K / 128K — 33%**

A segmented horizontal progress bar should appear beneath it.

Example:

`████████░░░░░░░░░░░░░░ 33%`

The meter should be visible without opening a separate settings panel.

### Color states

| Context usage | Appearance |
|---|---|
| 0–69% | Mint green |
| 70–89% | Amber |
| 90–100% | Coral/red |

These thresholds should communicate increasing context pressure without implying that the model will necessarily fail at a particular percentage.

### Expanded context details

Clicking the context meter should open a breakdown of the information contributing to the current request.

For example:

| Context component | Tokens |
|---|---:|
| System instructions | 3,200 |
| Conversation history | 18,400 |
| Retrieved memory | 9,100 |
| Project knowledge | 6,500 |
| Tool content | 5,600 |
| **Total** | **42,800** |

The exact breakdown should only appear if the backend can measure these components.

**The meter must measure the current effective context, not the cumulative lifetime token usage of the conversation.**

If older messages are summarized, truncated, or omitted, the displayed utilization should reflect that.

If precise counts cannot be obtained, the interface should clearly display that the figure is estimated.

---

## 2.5 Token consumption

Context utilization and token consumption are different measurements.

The interface should distinguish them.

**Context utilization** represents the amount of information currently occupying the model's available context window.

**Token consumption** represents the total input and output tokens used during requests.

The expanded usage panel should show:

- Input tokens for the most recent request.
- Output tokens for the most recent request.
- Total tokens consumed during the conversation.
- Estimated or reported cost.
- Model used for each request.

Where possible, usage should update after every completed model request.

---

## 2.6 Provider balance

The interface should display remaining account balance when the selected provider exposes that information.

For example:

**Balance: $8.42**

This figure should represent the actual provider-reported available credit, not a calculated or invented amount.

### Supported states

| Condition | Display |
|---|---|
| Actual balance available | `$8.42 remaining` |
| Provider doesn't expose a balance | `Balance not supported` |
| Credentials are missing | `Balance not configured` |
| Request fails | `Balance temporarily unavailable` |
| Local model | `Local — no API balance` |

The balance should update when the provider changes and after usage events, subject to provider reporting delays.

API credentials must remain on the backend.

---

## 2.7 Recommended chat-header layout

I would replace the current long, cramped status row with two clearly separated areas.

### Primary controls

```text
┌────────────────────────────────────────────────────────┐
│ ✦ Hermes                     Threads   New Chat  Close │
├────────────────────────────────────────────────────────┤
│                                                        │
│ Provider                  Model                         │
│ [ OpenRouter ▾ ]          [ DeepSeek V3.2 ▾ ]           │
│                                                        │
│ Context: 42.8K / 128K                         33%     │
│ ███████████░░░░░░░░░░░░░░░░░░░░░░░░░                    │
│                                                        │
│ Tokens: 15.2K     Session: $0.04     Balance: $8.42    │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│                 CONVERSATION AREA                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

These are illustrative values.

### Responsive behavior

On smaller screens, provider and model controls should stack vertically.

The context meter should remain visible, while detailed usage information can move into an expandable panel.

This prevents the configuration controls from taking up excessive space.

---

# 3. Integration requirements

Both upgrades must operate within the existing Hermes Life architecture.

### Conversation integration

Provider and model selections belong to the current conversation.

Usage statistics must be associated with the actual execution records.

Thoughts and responses must remain attached to the correct task and conversation.

### Backend integration

The backend must provide authoritative information for:

- Configured providers.
- Available models.
- Selected execution model.
- Model context capacity.
- Actual token usage, where reported.
- Request costs, where reported or reliably calculated.
- Provider account balances, where supported.

The frontend must distinguish between missing data, unsupported features, and API errors.

### Runtime integrity

Model selection must be applied to the actual Hermes execution process.

Updating a dropdown without changing the model used by Hermes is not sufficient.

Likewise, context percentages must not be approximated from unrelated data such as the number of messages or cumulative tokens.

---

# 4. Acceptance criteria

The upgrade is complete when the following behaviors are verified:

| Test | Expected result |
|---|---|
| Hermes emits commentary | Clearly labeled **💭 Hermesha's Thoughts** |
| Hermes produces a final answer | Clearly labeled **✨ Hermesha's Response** |
| Commentary isn't available | No fabricated thoughts section |
| Long Markdown response | Readable typography, spacing, and formatting |
| Code response | Properly formatted, non-italic code blocks |
| Provider changed | Available model list updates |
| Model changed | Next task uses the selected model |
| Conversation reopened | Provider/model selection is restored |
| Model limit known | Context meter displays meaningful utilization |
| Usage unavailable | Explicit unavailable state, not invented values |
| Provider reports balance | Actual account balance is displayed |
| Local model selected | No irrelevant account balance |
| Task history reopened | Original model and usage remain associated with the task |
| Existing task running | Model changes don't alter the running execution |

---

## Final intended result

These upgrades should make Hermes Life's Chat serve two distinct purposes:

**1. A readable conversation interface:** Hermesha's thoughts, execution narration, and final responses are immediately distinguishable through labels, colors, typography, spacing, and structured formatting.

**2. A transparent AI model-control interface:** Users can select the provider/model that Hermes actually uses and understand context utilization, token consumption, and available account credit.

The defining requirement is that **the visual interface must accurately represent what Hermes is doing**, rather than merely presenting attractive controls or invented telemetry.