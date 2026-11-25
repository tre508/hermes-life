# HERMES LIFE — UI/UX AUDIT V2

**Type:** AUDIT — point-in-time UI/UX assessment; findings are inputs, not requirements

> **STATUS 2026-11-25 — see the delivery record, not the line numbers below.**
> The user's live direction on 2026-11-25 supersedes parts of this document where the
> two disagree (the composer, in particular, was rebuilt to the three-area shape the
> user approved in-session rather than any variant described here). What shipped
> against this audit: Chat | Project tabs in the Conversations workspace (replacing
> the drawer + in-chat sidebar), the composer rebuilt as text entry / tools row /
> action row with ONE model selector and a compact usage chip (popovers), the project
> pill retired in favour of a single `Project:` control, thread rail at a fixed 280px
> with two-line rows and ✦ on the open thread, account controls moved to the global
> topbar (Logout + Passkey), the workspace heading compacted, a jump-to-latest chip,
> and the hidden-attribute/display overrides that fixed the tabs rendering stacked.
> Gated by `frontend/tests/chat-audit-layout.test.ts` (349 tests) and verified
> headless in Firefox; harnesses: `frontend/harness/composer-telemetry.html`,
> `frontend/harness/chat-shell.html`, `frontend/harness/project-tab.html`.
> Do not re-triage the numbered items below against current file:line refs — the
> tree has moved past them; re-verify against the live tree instead.

## Review of the redesigned AI assistant interface

**Overall assessment: 5.5/10 — improved from approximately 3.5/10.**

The redesign addresses several problems from the previous version. Conversation history is now visible, the floating chat window has been replaced with a larger workspace, and the message composer has more functionality.

However, **the biggest remaining problem is that the application still does not behave visually like a coherent AI assistant workspace.**

The interface now has more functionality, but its layout is fragmented. The conversation, composer, model controls, project selection, file management, and surrounding application panels compete for space.

The most concerning issue is the allocation of screen space: **the assistant's actual response is confined to a relatively small scrolling region while configuration controls and unrelated project-management elements occupy much of the viewport.**

There is also a new problem: the screen appears to combine a chat interface and project-management interface without clearly deciding whether they are separate views or parts of one workflow.

---

# 1. WHAT HAS IMPROVED SINCE THE PREVIOUS VERSION

Several changes are genuinely useful.

| Previous problem | Current status | Assessment |
|---|---|---|
| Narrow floating chat window | Replaced with wider chat workspace | Improved |
| Conversation history hidden behind Threads | Dedicated conversation list added | Improved |
| Composer limited to basic input | Multiline-style composer added | Improved |
| Missing attachment controls | Attach button added | Improved |
| Thread identity unclear | Active conversation now visible in sidebar | Improved, but incomplete |
| Model information unavailable | Usage and balance information displayed | Improved |
| Project context unclear | Project indicator added | Improved |
| Duplicate Logout inside chat | Replaced by Account button | Partially improved |
| Excessive nested chat framing | Reduced | Improved |
| Conversation/composer overlap | No obvious overlap in this screenshot | Improved |
| Excessively prominent user bubble | Not visible in current viewport | Cannot assess |
| Coding workflow integration | Project controls and files area added | Partially improved |

The direction is better.

But the redesign has introduced several additional layout and information-architecture problems.

---

# 2. CRITICAL: THE CONVERSATION VIEWPORT IS FAR TOO SHORT

**Severity: Critical**

This is the biggest problem in the new screenshot.

The entire chat interface extends approximately from y=218 to y=698.

However, the actual readable conversation occupies only approximately y=263 to y=486.

That gives the conversation roughly **223 pixels of visible height**.

The composer and its associated controls occupy approximately 210 pixels beneath it.

### Why this is unacceptable

The main purpose of an AI coding assistant is to read and interact with substantial responses.

A response containing an implementation audit, technical explanation, or code analysis might be thousands of words long.

Yet the user can see only a few paragraphs at a time.

This requires excessive scrolling.

It also prevents the user from maintaining context while reviewing the response.

### The underlying problem

The chat panel appears to have a constrained height despite considerable available screen space.

The application is allocating space to a separate Project files area below the chat rather than allowing the chat to occupy the primary workspace.

### Required fix

The conversation should expand to fill the available vertical space.

The composer should remain anchored to the bottom.

A proper structure would be:

```text
┌──────────────────────────────────────────────┐
│ Conversation header                          │
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
│         SCROLLABLE CONVERSATION              │
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│ Message composer                             │
└──────────────────────────────────────────────┘
```

**Priority: P0 — fix before further visual polishing.**

---

# 3. CRITICAL: THE COMPOSER IS ALMOST AS LARGE AS THE CONVERSATION

The current composer contains:

- Prompt input
- Attach button
- Workspace button
- Keyboard shortcut instructions
- Provider selector
- Model selector
- Account balance
- Models button
- Context usage
- Token usage
- Session cost
- Current project indicator
- Send button

This is far too much information inside the message composer.

### What's wrong

The composer has become a combined:

**Message editor + model configuration panel + billing dashboard + workspace selector + context monitor.**

These are distinct interface functions.

The actual text-entry area occupies only a small portion of the composer.

Meanwhile, two full rows are dedicated to provider, model, and usage metadata.

### Why this matters

The composer is the most frequently used control in the application.

Its primary purpose should be entering instructions.

Everything else should be secondary.

### Required fix

Reduce the composer to three functional areas:

**1. Text entry**

A comfortable multiline input.

**2. Context and attachment tools**

Files, workspace, commands, or agent mode.

**3. Primary action**

Send or Stop.

Move model configuration and detailed usage information elsewhere.

A better arrangement:

```text
┌───────────────────────────────────────────────────┐
│ Ask Hermesha to build, explain, fix, or research  │
│                                                   │
│                                                   │
│                                                   │
│ + Attach    @ Files    / Commands                 │
│                                                   │
│ hermes-life    GLM 5.3 Flash                 Send  │
└───────────────────────────────────────────────────┘
```

The composer should not resemble an administrative dashboard.

---

# 4. CRITICAL: THE PROJECT FILES PANEL IS IN THE WRONG PLACE

Below the chat interface is an entirely separate section titled:

**Project files**

This panel contains:

- Project selection
- Registered project indicators
- Register a project directory
- Multiple project chips
- Project-name input
- Register button

### What's wrong

The project-management interface is positioned directly beneath the conversation.

This creates a vertical split between chatting and managing projects.

However, the two activities have different spatial requirements.

The chat needs vertical space.

Project browsing and file inspection benefit from a sidebar or contextual panel.

### Why this arrangement is particularly poor

The user is forced to sacrifice conversation height to keep project registration controls visible.

Project registration is not an activity that needs permanent visibility during every conversation.

Registering a project is typically an occasional configuration task.

Reading and writing messages are continuous tasks.

The interface gives too much permanent space to the less frequent activity.

### Required fix

Move Project files into one of three places:

**Preferred:** A collapsible right-hand workspace panel.

**Alternative:** The Project tab, with the Chat tab using the full available height.

**Alternative:** A project-management page accessible through the existing navigation.

The project registration form should not be permanently visible beneath the main conversation.

---

# 5. CRITICAL: THE CHAT AND PROJECT TABS DO NOT HAVE A CLEAR RELATIONSHIP TO THE CONTENT

At the top of the workspace are two tabs:

**Chat | Project**

Yet the screenshot shows the chat interface and the Project files panel simultaneously.

### What's wrong

The visual structure suggests these are mutually exclusive views.

But the contents appear to be stacked together.

This creates ambiguity.

Does selecting Project hide the chat?

Does it switch the bottom panel?

Does it change the workspace?

Is Project a separate page or a contextual tab?

The layout does not communicate the relationship.

### What should change

Choose one coherent interaction model.

### Option A: True tabs

```text
[ Chat ] [ Project ]

Chat selected:
    Full-height conversation interface

Project selected:
    Full-height project management interface
```

### Option B: Split workspace

```text
┌────────────────────────────┬─────────────────────┐
│                            │                     │
│ Chat                       │ Project Files       │
│                            │                     │
│                            │                     │
└────────────────────────────┴─────────────────────┘
```

The current hybrid approach is visually confusing.

**My recommendation is Option A as the default, with an optional right-hand project inspector for coding workflows.**

---

# 6. CRITICAL: THE MAIN RESPONSE COLUMN IS STILL TOO NARROW

Although the outer workspace is wider, the assistant's actual text remains constrained.

The visible response occupies roughly the left portion of the main conversation area, leaving a large blank region on the right.

There is a vertical dividing line around x=940.

### What's wrong

The chat area is wider, but the content does not make effective use of that width.

The response appears to occupy approximately 650 pixels within a much larger conversation panel.

This is acceptable for ordinary prose, but problematic if the same constraint applies to code, diffs, tables, and technical output.

### Why it matters

The displayed message contains technical findings, file references, and an audit summary.

A coding assistant needs to support much wider content when necessary.

### Required fix

Separate the width of prose from technical content.

For example:

- Prose: 760–900px maximum reading width.
- Code blocks: expand to available conversation width.
- Diffs: full-width or dedicated inspector.
- Tables: responsive horizontal scrolling.
- File previews: separate artifact panel.

Also, remove the unused vertical boundary unless it represents an actual panel.

The screenshot suggests a split region without clearly showing what the second region is for.

---

# 7. HIGH: THERE IS A LARGE EMPTY AREA INSIDE THE CONVERSATION

The conversation panel has a substantial dark region to the right of the assistant response.

This creates the appearance of a two-column layout.

However, no visible content occupies the second column.

### What's wrong

The layout looks incomplete.

A blank panel can be useful when it is deliberately reserved for an artifact inspector, but it should not look like a permanently empty region.

### Required fix

If the right side is an artifact area, make it conditional.

When no artifact is open, the conversation should use the full workspace.

When an artifact is selected, the inspector should appear.

Do not reserve a large empty area for a panel that is not currently being used.

---

# 8. HIGH: THE ENTIRE CHAT PANEL STILL HAS AN UNNECESSARY OUTER BORDER

The redesign reduced the floating-window appearance, but the chat remains enclosed in a prominent rounded rectangle.

Inside that rectangle are additional bordered regions.

### What's wrong

The chat still looks like a component embedded in a page rather than the primary page content.

This contributes to the feeling that the interface is composed of independent widgets rather than one workspace.

### What should change

The chat should integrate with the application layout.

Use a subtle header separator and a distinct composer surface.

Avoid enclosing the entire conversation in a thick, rounded border.

Borders should delineate components that need separation, not every level of the page.

---

# 9. HIGH: THE CONVERSATION LIST IS TOO NARROW

The left conversation panel is approximately 210–215 pixels wide.

Within that space, each thread displays:

- A truncated title
- A timestamp
- A selection background

### What's wrong

Most conversation titles are truncated severely.

The visible labels provide little information about each thread.

The timestamps further reduce the available title width.

### Why this matters

A conversation list is useful only if users can identify conversations quickly.

If most titles display just a few words and an ellipsis, the user must rely on memory or open threads repeatedly.

### Required fix

Increase the thread sidebar width to approximately 260–300px.

Allow titles to wrap onto two lines where appropriate.

Move secondary timestamps below the title or display them on hover when appropriate.

An example:

```text
Implementation status audit
Today · 07:32

Fix authentication flow
Yesterday · 12:57

Review backend architecture
Monday · 14:12
```

This is more useful than a narrow single-line list with competing timestamps.

---

# 10. HIGH: THE CONVERSATION LIST DOES NOT USE ITS SPACE WELL

The thread list is densely packed.

Each conversation appears as a narrow row with minimal vertical separation.

### Problems

- Titles are hard to distinguish.
- Timestamps are tiny.
- Selected thread styling is visually heavy.
- Day headings use small uppercase text.
- Many entries appear nearly identical.

### What should change

Give each thread row more vertical breathing room.

Use consistent spacing between time groups.

Selected threads should have a clear but restrained background.

Consider showing a two-line title and metadata arrangement.

The goal is fast recognition, not maximum thread density.

---

# 11. HIGH: THE ACTIVE CONVERSATION TITLE IS NOT CLEARLY DISPLAYED

The chat header contains an avatar followed by a long, blurred title or label.

The screenshot does not clearly communicate whether that text is:

- The assistant name
- The current conversation title
- The project name
- A combination of several values

### What's wrong

The active thread needs a clearly identifiable title.

A coding assistant often has multiple conversations associated with the same project.

Without a prominent title, switching between them becomes confusing.

### What should change

Use a structured header:

**Implementation Status Audit**

`hermes-life · GLM 5.3 Flash · Ready`

The title should be editable through a clear affordance.

The assistant's name does not need to occupy the same position as the conversation title.

---

# 12. HIGH: THE ACCOUNT BUTTON STILL DOES NOT BELONG IN THE CHAT HEADER

The chat header contains an **Account** button.

There is also a global Logout control at the top right of the application.

### What's wrong

Account management is a global application function.

It should not occupy space within the current conversation.

This is a remaining example of the nested-chat-widget architecture.

### Required fix

Move account management to the global application header.

Remove it from the dedicated chat interface.

The chat header should contain only conversation-related information and actions.

---

# 13. HIGH: PROVIDER AND MODEL CONTROLS ARE STILL TOO PROMINENT

The composer permanently displays:

**Provider: openrouter**

**Model: GLM 5.3 Flash (default)**

There is also a **Models** button.

### What's wrong

The redesign moved these controls but did not solve the original problem.

They still occupy significant space.

There is also duplication between selecting a model and opening the Models control.

### Required fix

Use a single model-selector component:

**GLM 5.3 Flash ▾**

Inside the selector, show:

- Provider
- Available models
- Model capabilities
- Relevant pricing information

Keep the currently selected model visible in the composer toolbar.

Move advanced configuration out of the primary interaction area.

---

# 14. HIGH: BILLING INFORMATION IS IN THE COMPOSER

The screenshot shows:

**Balance: $10.95 remaining**

**Session: $0.02**

These are potentially useful details, especially when using paid API models.

However, their placement is inappropriate.

### What's wrong

Billing details appear alongside the message composition tools.

The user sees account balance and session cost while writing instructions.

This creates unnecessary visual competition.

### What should change

Move balance and usage information to a compact usage indicator or model details panel.

For example:

**GLM 5.3 Flash · $0.02 session**

Clicking the indicator could reveal detailed usage.

The account balance does not need permanent visibility inside the composer unless the balance is low or the user explicitly chooses to show it.

---

# 15. HIGH: THE CONTEXT USAGE BAR IS TOO SMALL TO BE USEFUL

The composer displays:

**Context: 54.4K / 1048.6K — 5%**

alongside a small horizontal progress bar.

### What's wrong

The bar is extremely small.

The percentage is already displayed numerically.

The visual bar adds little information.

At 5%, the progress indicator is barely perceptible.

### Why this matters

A usage indicator should help the user understand whether they are approaching a meaningful limit.

At the moment, the display communicates technical detail without providing much practical value.

### Required fix

Use a compact contextual indicator.

For example:

**Context 5%**

On hover or click:

`54.4K of 1.05M tokens`

Consider showing the detailed indicator only when the context is becoming constrained.

The exact threshold should depend on the model and application behavior.

---

# 16. HIGH: TOKEN METRICS ARE UNCLEAR

The interface displays:

**Tokens: 645.8K**

and:

**Context: 54.4K / 1048.6K — 5%**

These metrics may be correct, but their meanings are not clear.

### What's wrong

The user cannot tell whether 645.8K represents:

- Total tokens consumed in the session
- Lifetime conversation usage
- Input tokens
- Combined input/output tokens
- Provider-reported usage

The relationship between context occupancy and cumulative token usage is not explained.

### What should change

Use explicit labels in the detailed usage view.

For example:

**Current context:** 54.4K / 1.05M

**Session tokens used:** 645.8K

**Session cost:** $0.02

If the metrics refer to different scopes, those scopes must be clearly identified.

---

# 17. HIGH: THE SEND BUTTON IS VISUALLY DISCONNECTED FROM THE TEXT INPUT

The text-entry area is at the top of the composer.

The Send button is positioned at the bottom-right, beneath multiple rows of configuration and metadata.

### What's wrong

The primary action is physically separated from the input it acts upon.

The relationship between writing a message and sending it is less direct than it should be.

### Required fix

Place Send on the same bottom row as the composer tools.

Avoid inserting billing and model-information rows between the text field and Send.

The Send button should feel like part of the text-entry component.

---

# 18. HIGH: THE COMPOSER HAS TOO MANY HORIZONTAL SECTIONS

The composer is split into multiple stacked rows.

These include:

1. Input placeholder
2. Attachment and workspace controls
3. Provider/model/balance controls
4. Context/tokens/session metrics
5. Project indicator and Send

### What's wrong

The amount of visual segmentation is disproportionate to the task.

The composer looks more like a configuration form than a message input.

### Required fix

Consolidate to:

**Text-entry area**

**Single controls row**

Move the remaining information to contextual menus.

This would substantially reduce composer height.

---

# 19. HIGH: THE PROJECT CONTEXT IS DISPLAYED IN MULTIPLE PLACES

The interface shows project-related information in several locations:

- Workspace button in composer
- `hermes-life` project indicator at bottom-left
- Project files panel
- Project selection chips
- Register a project directory section

### What's wrong

The same general concept is repeated across different components.

This makes it difficult to determine which element represents the authoritative active project.

### What should change

Establish a single active project selector.

For example:

**Project: hermes-life ▾**

The selector should clearly identify the active workspace.

Project management should be accessible from that control or from the Project view.

Avoid duplicating active project state across several unrelated UI regions.

---

# 20. HIGH: THE PROJECT REGISTRATION INTERFACE LOOKS LIKE A DEVELOPER CONFIGURATION FORM

The lower section contains a registration area with many directory chips and a project-name input.

### What's wrong

This looks like an internal configuration interface exposed directly inside the main product.

The user is presented with numerous project identifiers without much context.

The registration workflow is visually dense and lacks a clear step-by-step structure.

### What should change

Project registration should be a dedicated interaction.

For example:

**Add Project**

1. Select directory.
2. Confirm project name.
3. Register.

This can be implemented as a modal or dedicated project-management view.

The main chat interface should not permanently show the registration form.

---

# 21. HIGH: PROJECT DIRECTORY CHIPS ARE TOO DENSE

The project registration area contains numerous small chips.

Examples include:

- QG
- Vid-Gayzer
- gayzed-media
- haruna
- hermes-life
- hl-demo-worker
- media-viewer
- slasher
- video-dedupe

### What's wrong

The chips are packed tightly.

Some appear selected or disabled, while others have normal styling.

It is not immediately clear whether the chips represent:

- Available directories
- Registered projects
- Recent projects
- Project shortcuts
- Suggested project names

### Required fix

Use a more explicit selection interface.

For example:

```text
Available directories

○ QG
○ Vid-Gayzer
○ gayzed-media
● hermes-life
○ hl-demo-worker
○ media-viewer
```

For many directories, a searchable list would be preferable.

The relationship between available and already-registered projects should be clearly communicated.

---

# 22. HIGH: THE PROJECT PANEL HAS AN UNEXPLAINED EMPTY REGION

Below the chat, on the left side of the Project files area, there is a large empty region with a bordered rectangle near its top.

### What's wrong

This looks like an unfinished sidebar, search box, or file-tree container.

The screenshot provides no visible label explaining its purpose.

The empty region consumes a significant amount of horizontal space.

### What should change

If this is intended to show a file tree, give it a clear heading and appropriate empty state.

If it is not needed in the current view, hide it.

Do not display large empty panels without a clearly communicated purpose.

---

# 23. HIGH: THE PAGE CONTAINS TWO COMPETING SIDEBARS

The main chat includes a conversation-history sidebar.

Below it, the Project files area appears to introduce a separate left-hand panel.

### What's wrong

The application uses different horizontal structures for related functionality.

The conversation area has one sidebar.

The project area has another.

Neither appears clearly integrated into the broader application navigation.

This creates a fragmented layout.

### What should change

Use a consistent workspace layout.

For example:

```text
Global navigation | Context navigation | Main workspace | Optional inspector
```

The context-navigation area can change based on the selected view.

In Chat mode, it shows conversations.

In Project mode, it shows project files.

This is more coherent than stacking separate interfaces with independent sidebars.

---

# 24. HIGH: THE CHAT PANEL AND PROJECT PANEL HAVE INCONSISTENT CONTAINER STYLES

The chat interface uses rounded corners and prominent borders.

The Project files section uses a more rectangular panel arrangement.

The tabs sit above both sections.

### What's wrong

The components do not appear to belong to the same layout system.

The chat looks like a self-contained application.

The project-management area looks like a separate administrative panel.

### What should change

Define consistent rules for:

- Surface backgrounds
- Corner radii
- Borders
- Internal padding
- Panel headers
- Active states
- Dividers

The same workspace framework should be used for both Chat and Project views.

---

# 25. HIGH: THE PAGE HAS TOO MANY LEVELS OF NAVIGATION

The screenshot shows:

**Global application header**

Then a page-level heading.

Then Chat and Project tabs.

Then a Conversations sidebar.

Then a chat header.

Then project controls inside the composer.

Then a Project files panel.

This creates multiple levels of navigation and context selection.

### What's wrong

The hierarchy is difficult to interpret.

The user must distinguish between application navigation, page tabs, conversation selection, project selection, and workspace controls.

### Required fix

Define three primary levels:

**Level 1: Application section**

Chat, Work, Knowledge, etc.

**Level 2: Working context**

Conversation or project.

**Level 3: Contextual tools**

Files, model, execution mode, artifacts.

Avoid creating additional navigation levels unless they serve a clearly distinct purpose.

---

# 26. MEDIUM-HIGH: THE TOP OF THE PAGE STILL WASTES SPACE

The screenshot shows the global application header, then another page header, then tabs, then the chat panel.

There is substantial vertical overhead before the first message appears.

### What's wrong

The page consumes valuable space establishing where the user is.

Some of the heading text is obscured in the screenshot, so its exact content cannot be evaluated.

However, the layered structure is clear.

### Required fix

Reduce the number of persistent header rows.

The conversation workspace should begin closer to the top of the application content area.

---

# 27. MEDIUM-HIGH: THE PAGE APPEARS TO HAVE A HEIGHT-CONSTRAINT PROBLEM

The chat panel ends well above the bottom of the viewport.

The project panel then occupies the space beneath it.

The application footer remains fixed at the bottom.

### What's wrong

The interface appears to divide the available height through fixed or constrained regions rather than allowing the active workspace to grow naturally.

This is the likely underlying cause of the cramped conversation.

### What should change

Use a coherent flex or grid layout with an explicitly defined scrollable conversation region.

Avoid fixed heights for the primary chat area unless there is a deliberate resizable split layout.

The exact CSS cause cannot be established from the screenshot alone.

---

# 28. MEDIUM-HIGH: THE INTERFACE IS STILL TOO BORDER-HEAVY

Borders surround:

- Chat panel
- Conversation sidebar
- Search field
- Active thread
- Chat header
- Composer
- Attachment controls
- Workspace button
- Model selectors
- Usage controls
- Project chips
- Registration form
- Project-name input
- Footer buttons

### What's wrong

Almost every interface element has a visible outline.

This creates a technical-dashboard aesthetic but reduces visual clarity.

### What should change

Use borders selectively.

Prefer whitespace, background differences, and typography for structural separation.

Keep explicit borders for inputs, code blocks, active selections, and meaningful panel boundaries.

---

# 29. MEDIUM-HIGH: THE VISUAL HIERARCHY IS STILL WEAK

The screen contains multiple areas competing for attention:

- Conversation list
- Assistant response
- Composer controls
- Model configuration
- Usage metrics
- Project registration
- Footer indicators

No single region receives sufficiently strong priority.

### What's wrong

The assistant response should dominate while the user is reading.

Instead, the composer and project-management interface consume comparable visual weight.

### What should change

The active task should determine the dominant region.

When chatting, the conversation is primary.

When browsing files, the file browser is primary.

When reviewing code, the artifact inspector is primary.

Do not give every subsystem equal prominence.

---

# 30. MEDIUM-HIGH: THE APPLICATION STILL LOOKS LIKE AN INTERNAL OPERATIONS DASHBOARD

The visual language remains heavily technical.

Small controls, dense metadata, outlined panels, and compact labels are used throughout.

### What's wrong

A personal AI assistant should feel approachable during everyday conversations.

A coding assistant should feel efficient during technical work.

The current interface looks like a monitoring dashboard in both situations.

### What should change

Introduce stronger separation between everyday interaction and advanced technical controls.

The application can preserve its technical identity without making every screen look like a developer console.

---

# 31. MEDIUM: THE TEXT ENTRY AREA NEEDS MORE VISUAL EMPHASIS

The composer placeholder reads:

**Ask Hermesha to build, explain, fix, or research...**

That wording is appropriate.

However, the input's visual treatment is weak compared with the controls beneath it.

### What's wrong

The large composer container does not translate into a large, comfortable text-entry experience.

Much of the surface is consumed by controls and metadata.

### Required fix

Make the typing area the visually dominant part of the composer.

Give it sufficient internal padding and room to expand.

Minimize unrelated content around it.

---

# 32. MEDIUM: KEYBOARD SHORTCUT HELP IS TOO SMALL

The composer displays:

**Enter to send · Shift+Enter for a new line**

This is useful information.

However, it is very small and positioned far to the right.

### What's wrong

The hint is difficult to read.

Its permanent presence also competes with the attachment toolbar.

### What should change

Use a more compact hint or show it contextually.

For example, a tooltip on the Send button or a small helper line inside the composer when focused.

The shortcut convention itself is reasonable.

---

# 33. MEDIUM: THE SEND BUTTON IS TOO SMALL RELATIVE TO THE COMPOSER

The Send button is relatively compact and located at the bottom-right corner of a large control area.

### What's wrong

The button's relationship to the message input is weak.

The visual contrast is appropriate, but the layout makes it feel detached.

### Required fix

Place it directly on the composer's action row.

The current mint color can be retained.

---

# 34. MEDIUM: THE THREAD SEARCH FIELD IS TOO COMPACT

The conversation search input occupies the width of the narrow sidebar.

It is also relatively short vertically.

### What's wrong

The field works visually as a utility control, but it could be easier to interact with.

The current sidebar layout leaves limited room for displaying search results.

### What should change

Increase the sidebar width and give the search field a more comfortable interaction target.

Search results should retain enough space for recognizable thread titles.

---

# 35. MEDIUM: THE THREAD GROUP HEADINGS ARE TOO SMALL

The conversation list uses headings such as:

**TODAY**

**THIS WEEK**

These provide useful grouping.

However, their typography is very small and muted.

### What's wrong

The headings are easy to overlook.

This weakens the hierarchy of the conversation list.

### What should change

Use slightly larger section labels with consistent spacing above and below.

The headings should remain secondary but clearly distinguish groups of conversations.

---

# 36. MEDIUM: THE SELECTED THREAD STYLE IS TOO HEAVY

The selected conversation has a filled teal background and a bright accent along its left edge.

### What's wrong

The selection state is visually strong relative to the compact thread rows.

It draws attention toward the sidebar rather than the active conversation.

### What should change

Use a more restrained selected state.

A subtle background and narrow accent indicator should be sufficient.

---

# 37. MEDIUM: THE ASSISTANT RESPONSE IS NOT VISUALLY DISTINCT ENOUGH FROM THE SURROUNDING SURFACE

The assistant's response sits on a dark background similar to the surrounding workspace.

The response text is readable, but the boundaries between message content and container structure are not especially clear.

### What's wrong

The interface relies heavily on container geometry rather than a clear message structure.

In a longer conversation, message boundaries and roles need to remain obvious.

### What should change

Use consistent role identification, spacing, and typography.

Avoid wrapping every assistant message in a heavy card.

Subtle message grouping is preferable.

---

# 38. MEDIUM: THE ASSISTANT RESPONSE IS VERTICALLY CRAMPED

The visible response contains a technical paragraph and a bold "Bottom line" section.

The text is reasonably readable.

However, the scroll region is so short that the message appears clipped.

### What's wrong

The user cannot see enough surrounding context to understand where they are within the answer.

### What should change

Fix the viewport height first.

Only then refine line height, paragraph spacing, and heading hierarchy.

Typography adjustments alone will not solve this problem.

---

# 39. MEDIUM: THE CONVERSATION SCROLL POSITION IS NOT CLEAR

The screenshot shows the middle or end of an assistant response.

There is no clearly visible scrollbar or progress indication.

### What's wrong

The user may not know how much content exists above or below the current viewport.

This is particularly problematic when the conversation area is very short.

### What should change

Provide conventional scroll behavior and ensure the scrollbar is discoverable.

If the user scrolls away from the latest message, a "Jump to latest" control can help restore their position.

The actual scrolling behavior requires interaction testing.

---

# 40. MEDIUM: THE COMPOSER DOES NOT CLEARLY INDICATE THE ACTIVE AGENT MODE

The interface supports building, explaining, fixing, and researching according to its placeholder.

However, no visible mode distinction appears near the composer.

### What's wrong

A user may not know whether a request will result in:

- A conversational answer
- A proposed plan
- File inspection
- Code changes
- Command execution

This matters if the assistant supports autonomous tool use.

### What should change

If different permission or execution modes exist, expose the active mode.

For example:

**Ask | Plan | Agent**

If no meaningful mode distinction exists, do not add artificial controls.

Instead, communicate tool permissions through the relevant workspace settings.

---

# 41. MEDIUM: THE CURRENT PROJECT INDICATOR IS TOO SUBTLE

The active project appears as a small pill:

**hermes-life**

It sits at the bottom-left of the composer.

### What's wrong

The project context is important for coding tasks, yet the indicator is easy to overlook.

At the same time, less important billing and usage information receives substantial space.

### What should change

Make the project context clear but compact.

For example:

**Project: hermes-life ▾**

It should be easy to identify and change the active project.

The selected project should not be confused with the current conversation.

---

# 42. MEDIUM: THE PROJECT FILES PANEL IS NOT REALLY A FILE BROWSER

Despite being titled Project files, the visible panel primarily displays project registration controls.

There is no meaningful file tree or file list shown.

### What's wrong

The heading creates an expectation that the user can browse project files.

The displayed content focuses on registering and selecting project directories.

Those are separate tasks.

### What should change

Distinguish between:

**Projects:** Register, select, and manage projects.

**Files:** Browse and inspect files within a selected project.

The interface should not use "Project files" as an umbrella label for unrelated configuration tasks.

---

# 43. MEDIUM: THE PROJECT REGISTRATION INPUT LACKS CONTEXT

The input placeholder reads:

**project-name (lowercase, digits, hyphens)**

This provides formatting guidance.

However, the overall workflow remains unclear.

### What's wrong

The UI does not visibly explain whether the user is naming an existing selected directory, creating a new directory, or registering an existing folder.

### What should change

Use a clearly structured form with explicit labels.

For example:

**Register existing project**

Directory: `~/Apps/hermes-life`

Project name: `hermes-life`

**Register Project**

This would clarify the operation.

---

# 44. MEDIUM: PROJECT SELECTION AND PROJECT REGISTRATION ARE MIXED

The Project files panel shows active project chips above the registration form.

### What's wrong

Selecting an existing project and registering a new one are different workflows.

Displaying them in the same compact region without clear separation makes the interface harder to understand.

### What should change

Separate:

**Current and registered projects**

from:

**Add a project**

The registration form should appear only when the user initiates the Add Project action.

---

# 45. MEDIUM: THE GLOBAL HEADER STILL CONTAINS A SECOND CHAT ENTRY POINT

At the top-right, there is a **Chat** button.

The user is already viewing the chat interface.

### What's wrong

This creates redundant navigation.

It may be intended to open a floating assistant from anywhere in the application.

If so, that behavior needs to be distinguished from the dedicated Chat page.

### What should change

When the user is on the dedicated chat page, either:

- Hide the floating-chat launcher.
- Change its behavior to a clearly labeled separate assistant view.
- Use it only when the current page is outside the chat workspace.

Do not display two indistinguishable entry points to the same feature.

---

# 46. MEDIUM: THE GLOBAL HEADER CONTAINS AN UNEXPLAINED COUNT BADGE

There is an orange badge displaying **18** near the Chat button.

### What's wrong

Its meaning is not apparent.

Does it represent:

- Notifications
- Unread messages
- Pending tasks
- Agent activity
- Conversations

The badge has strong visual emphasis without a clear label.

### What should change

Provide an accessible label and explanatory tooltip.

If it represents notifications, associate it with an appropriate notification control.

Do not place unexplained numeric badges beside primary navigation.

---

# 47. MEDIUM: THE FOOTER IS STILL OVERLOADED

The bottom status bar remains dense.

It displays:

- Last event
- Updated time
- Live status
- Working count
- Waiting count
- Goal completion count
- Failed count
- Operational message
- Roles
- Bubbles
- Motion
- Activity
- Sync

### What's wrong

The previous audit identified this issue, and it remains largely unresolved.

The footer tries to communicate too many independent systems.

### Required fix

Reduce the default footer to essential operational status.

For example:

```text
● Connected     0 active tasks     2 waiting       Activity
```

Move detailed status and diagnostics into an expandable panel.

---

# 48. MEDIUM: THE FOOTER TYPOGRAPHY IS TOO SMALL

The footer uses very compact text.

On a large desktop display, this may be readable at close range.

However, it is clearly smaller than the main interface typography.

### What's wrong

Important operational information is difficult to scan.

The compact styling also makes the footer look like a debugging interface.

### What should change

Increase the readability of retained status information.

Remove less important information rather than shrinking all text to fit.

---

# 49. MEDIUM: THE TOP AND BOTTOM BARS CREATE UNNECESSARY CHROME

The application uses both a global header and a global status bar.

That is not inherently problematic.

However, the content between them is already heavily segmented.

### What's wrong

The interface devotes substantial vertical space to persistent application chrome.

This compounds the shortage of conversation space.

### What should change

Keep both bars compact.

Avoid additional nested headers and controls within the central workspace.

The primary conversation should receive most of the available height.

---

# 50. MEDIUM: THE ENTIRE SCREEN LACKS A CLEAR SPATIAL HIERARCHY

This is the central visual-design issue.

The page currently reads as a stack of independent modules:

```text
Global header

Page heading

Chat / Project tabs

Chat module
    Conversation list
    Assistant response
    Composer
    Model settings
    Usage metrics

Project files module
    Project selectors
    Registration form

Global status bar
```

### What's wrong

The modules have different purposes but compete for screen space.

The user's current task does not determine which module is primary.

### What should change

Create a stable application shell with one dominant workspace.

Secondary content should appear through tabs, side panels, or expandable inspectors.

Avoid stacking complete feature interfaces vertically.

---

# 51. POTENTIAL ISSUE: CHAT AND PROJECT SCROLLING MAY CONFLICT

The screenshot suggests several possible scroll regions:

- Main page
- Conversation history
- Chat response
- Project files

If all are independently scrollable, interaction could become awkward.

### What should be tested

When the user scrolls over the chat, does only the conversation move?

When the user reaches the top of a conversation, does scrolling unexpectedly move the page?

Does the conversation list scroll independently?

Can the user reach the project panel without affecting their chat position?

These are interaction questions that cannot be answered from the screenshot alone.

---

# 52. POTENTIAL ISSUE: THE LAYOUT MAY NOT ADAPT WELL TO SMALLER SCREENS

The current desktop layout contains multiple columns and stacked panels.

At narrower viewport widths, this arrangement could become difficult to use.

### What should change

The responsive design should prioritize:

1. Conversation
2. Composer
3. Conversation history
4. Project context
5. Advanced configuration

The conversation history and project inspector should become collapsible at smaller widths.

The application should not simply shrink all controls to fit.

---

# 53. POTENTIAL ISSUE: AGENT EXECUTION IS STILL NOT FIRST-CLASS

The interface now exposes some project functionality.

However, the visible chat response still appears as ordinary conversational text.

There is no visible execution timeline, tool activity grouping, or file-change inspector.

This may exist outside the current viewport.

### What should change

If Hermesha can inspect and modify code, tool execution should be represented in the conversation.

For example:

```text
Hermesha is inspecting the project

✓ Read specification
✓ Located implementation files
✓ Compared existing components
✓ Completed audit

View execution details
```

This should be generated from actual tool events.

---

# 54. POTENTIAL ISSUE: THE ACTIVE PROJECT MAY NOT BE TIED CLEARLY TO THE CURRENT CONVERSATION

The composer identifies `hermes-life` as the active project.

The conversation list contains multiple threads.

The Project files panel supports selecting different projects.

### What's unclear

When the user changes the active project:

Does the current thread retain its original project association?

Does the assistant's working directory change?

Are earlier file references still valid?

Can a conversation switch projects?

These are important interaction-model questions.

### What should change

Define the relationship between conversation and project context explicitly.

The UI should communicate whether a project is attached to a thread or selected globally.

---

# 55. POTENTIAL ISSUE: MODEL CHANGES DURING A CONVERSATION ARE NOT EXPLAINED

The composer provides a model selector.

However, the interface does not explain whether changing models applies:

- Only to the next message
- To the entire conversation
- To future conversations
- To the selected project

This may already be implemented correctly.

The concern is that the scope is not visually obvious.

A concise model selector and consistent application behavior would address most of this.

---

# 56. POTENTIAL ISSUE: THE PROJECT REGISTRATION FORM MAY CREATE DUPLICATE OR AMBIGUOUS PROJECTS

The panel displays multiple project chips, including what appear to be registered projects.

It also provides a project-name field.

The screenshot does not show how duplicate names or already-registered directories are handled.

### What should change

The registration workflow should clearly identify existing registrations and prevent ambiguity.

This is a workflow-verification item rather than a confirmed defect.

---

# 57. POTENTIAL ISSUE: ACCESSIBILITY STILL NEEDS VERIFICATION

The redesign retains many small text labels and compact controls.

Particular areas of concern include:

- Thread timestamps
- Day-group headings
- Context metrics
- Token metrics
- Footer status
- Project chips
- Keyboard shortcut help

The screenshot also contains multiple subtle color differences between dark surfaces.

Actual accessibility compliance requires checking contrast, focus states, keyboard navigation, and semantic markup.

---

# 58. POTENTIAL ISSUE: THE CURRENT UI DOES NOT SHOW ERROR OR APPROVAL STATES

The screenshot shows a completed response and an idle composer.

It does not reveal what happens when:

- A tool call fails.
- A command requires approval.
- An operation is cancelled.
- A model request times out.
- The provider balance becomes insufficient.
- The working directory becomes unavailable.

These are important states for an operational AI coding assistant.

They need dedicated design review and interaction testing.

---

# THE SEVEN MOST IMPORTANT REMAINING PROBLEMS

The issues above have common causes.

| Rank | Problem | Severity |
|---|---|---|
| 1 | Conversation viewport is much too short | Critical |
| 2 | Chat and Project interfaces are stacked vertically | Critical |
| 3 | Composer contains too much configuration and metadata | Critical |
| 4 | Assistant output does not use available workspace effectively | High |
| 5 | Project management occupies permanent space during chat | High |
| 6 | Conversation, workspace, and project navigation are fragmented | High |
| 7 | The application still has excessive visual density | High |

**These should be fixed before adding more features or visual detail.**

---

# RECOMMENDED V3 LAYOUT

The best next iteration would use a single, full-height workspace with optional contextual panels.

## Default chat view

```text
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ HERMES LIFE                                  Search                     Account      │
├───────────────┬──────────────────────┬────────────────────────────────────────────────┤
│               │                      │                                                │
│ APPLICATION   │ CONVERSATIONS        │ Implementation Status Audit                    │
│               │                      │ hermes-life · GLM 5.3 Flash           Ready    │
│ World         │ + New Chat           ├────────────────────────────────────────────────┤
│ Conversations │                      │                                                │
│ Work          │ Search conversations │                                                │
│ Activity      │                      │                                                │
│ Knowledge     │ TODAY                │                                                │
│ Research      │                      │                                                │
│               │ Implementation audit │                                                │
│ ROOMS         │                      │                                                │
│               │ Login bug            │                CONVERSATION                    │
│ Control Room  │                      │                                                │
│ Dev Station   │ YESTERDAY            │                                                │
│ Lab           │                      │                                                │
│ Archive       │ Architecture review  │                                                │
│               │                      │                                                │
│               │                      │                                                │
│               │                      │                                                │
│               │                      ├────────────────────────────────────────────────┤
│               │                      │ Ask Hermesha to build, explain, or research…   │
│               │                      │                                                │
│               │                      │                                                │
│               │                      │ + Attach  @ Files   hermes-life   GLM 5.3  Send│
├───────────────┴──────────────────────┴────────────────────────────────────────────────┤
│ ● Connected                              0 active tasks                    Activity   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The conversation should fill the available vertical space between its header and composer.

There should be no permanently visible project registration form.

## Coding workspace with project inspector

When the user needs to inspect project files:

```text
┌───────────────┬──────────────────────┬───────────────────────────┬────────────────────┐
│               │                      │                           │                    │
│ APPLICATION   │ CONVERSATIONS        │ CHAT                      │ PROJECT FILES      │
│               │                      │                           │                    │
│ World         │ Implementation audit │ Assistant response        │ hermes-life        │
│ Conversations │                      │                           │                    │
│ Work          │ Login bug            │                           │ src/               │
│ Activity      │                      │                           │ components/        │
│ Knowledge     │ Architecture review  │                           │ lib/               │
│ Research      │                      │                           │ tests/             │
│               │                      │                           │                    │
│               │                      │                           │                    │
│               │                      │                           │                    │
│               │                      ├───────────────────────────┤                    │
│               │                      │ Composer                  │                    │
│               │                      │                           │                    │
└───────────────┴──────────────────────┴───────────────────────────┴────────────────────┘
```

The project inspector should be collapsible.

For complex coding tasks, the conversation list could also collapse to provide more room.

The layout should adapt to the task rather than permanently displaying every feature.

---

# WHAT I WOULD CHANGE FIRST

I would make the next redesign in three passes.

### Pass 1 — Fix the fundamental layout

Remove the Project files panel from beneath the conversation. Make the chat fill the available viewport height. Keep the composer anchored at the bottom and remove unnecessary nested borders.

This is the most important pass because it addresses the largest usability problem.

### Pass 2 — Simplify the composer

Move billing, detailed usage metrics, provider configuration, and project registration out of the composer.

Keep the active model, project, attachments, and primary Send action accessible.

Give the text input more room.

### Pass 3 — Establish consistent workspace navigation

Make Chat and Project distinct views or use a collapsible project inspector.

Widen the conversation list, clarify the active thread title, and establish one authoritative project selector.

After those changes, refine typography, contrast, border treatments, and status indicators.

---

# UPDATED UX SCORECARD

| Category | Previous version | Current version |
|---|---:|---:|
| Visual identity | 6/10 | 7/10 |
| Layout architecture | 3/10 | 4/10 |
| Space utilization | 2/10 | 3/10 |
| Conversation readability | 3/10 | 4/10 |
| Composer usability | 3/10 | 5/10 |
| Conversation navigation | 2/10 | 7/10 |
| Information hierarchy | 3/10 | 4/10 |
| Model configuration | 3/10 | 5/10 |
| Project integration | 2/10 | 6/10 |
| Coding-agent workflow | 3/10 | 5/10 |
| Visual consistency | 5/10 | 6/10 |
| Functional discoverability | 3/10 | 5/10 |

**Overall: approximately 5.5/10.**

These are qualitative UX assessments based on the screenshots, not usability-test results.

## Final assessment

The second version is better organized than the first, but the redesign has focused too heavily on **adding features and exposing information rather than optimizing the primary workflow**.

The previous version suffered from a floating chat window that was too small.

The new version suffers from a full-width chat interface whose actual conversation area is still too small.

That is the central issue.

The additional conversation history, model metrics, project integration, and registration tools are useful capabilities. But they have been assembled in a way that sacrifices the space needed to use the assistant.

**The next version should not add anything. It should remove unnecessary permanent UI, separate chat from project administration, and make the conversation occupy most of the available screen.**

The most effective architectural change is:

**One full-height conversation workspace, one compact composer, one conversation navigator, and one optional project/artifact inspector.**

That would resolve the majority of the serious problems visible in this screenshot without requiring a complete visual rebrand.