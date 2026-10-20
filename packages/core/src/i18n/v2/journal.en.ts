/**
 * v2 strings for the journal (spec §7; copy source Annex J §7 as amended):
 * `journal.*`, `settings.reviewCadence*`, `shortcuts.newEntry|goJournal` and
 * `notify.review*`. Cue chips use the shared `cue.*` keys (`journal.cue.*` is
 * dropped). Owner: T3.
 *
 * Every prompt is grounded in *Atomic Habits*. The review and integrity
 * questions are James Clear's own (ch. 20); weekly and monthly reviews reuse
 * the Annual Review questions and say so. Cue chips are not attributed to the
 * book. Spread into `en.ts`; every key also lives in `journal.pt-BR.ts`.
 */
export const journalEn = {
	// ── Settings, shortcuts, review reminder ──
	"settings.reviewCadence": "Reflection prompts",
	"settings.reviewCadenceHint":
		"A short review at the end of each week or month, plus the Annual Review in December and the Integrity Report in June.",
	"settings.reviewCadence.weekly": "Weekly",
	"settings.reviewCadence.monthly": "Monthly",
	"settings.reviewCadence.off": "Off",
	"shortcuts.newEntry": "New journal entry",
	"shortcuts.goJournal": "Go to Journal",
	"notify.reviewTitle": "Time for your weekly review",
	"notify.reviewTitleMonth": "Time for your monthly review",
	"notify.reviewBody": "Three questions: what went well, what didn't, what you learned.",

	// ── Journal page and editor chrome ──
	"journal.title": "Journal",
	"journal.subtitle": "Evidence for who you're becoming",
	"journal.new": "New entry",
	"journal.write": "Write",
	"journal.search": "Search your journal",
	"journal.filter.allIdentities": "All identities",
	"journal.filter.noIdentity": "No identity",
	"journal.filter.dayNotes": "Day notes",
	"journal.filter.kinds": "Filter by kind",
	"journal.filter.clear": "Clear filters",
	"journal.pinned": "Pinned",
	"journal.pin": "Pin",
	"journal.unpin": "Unpin",
	"journal.delete": "Delete entry",
	"journal.deleted": "Entry deleted",
	"journal.saving": "Saving…",
	"journal.saved": "Saved",
	"journal.unfinished": "Unfinished",
	"journal.required": "Required",
	"journal.anyOf": "Answer at least one of these.",
	"journal.empty": "Your journal starts with one line",
	"journal.emptyBody":
		"Write down one piece of evidence for who you're becoming. Collect enough proof and what you believe about yourself starts to change.",
	"journal.emptyCta": "Write evidence",
	"journal.noMatches": "No entries match these filters.",
	"journal.about": "About {date}",
	"journal.noHabit": "No habit",
	"journal.noIdentity": "No identity",
	"journal.deletedIdentity": "Deleted identity",
	"journal.deletedHabit": "Deleted habit",
	"journal.deletedIdentityName": "{name} (deleted)",
	"journal.deletedHabitName": "{name} (deleted)",
	"journal.dayNote": "Day note · {habit}",
	"journal.newerVersion": "Created in a newer version of Atomic.",
	"journal.privacy":
		"Your journal lives on this device and syncs to your account when you're signed in. On the server it is not end-to-end encrypted — turn off Sync journal to keep it here. It is never sent to AI.",
	"journal.card.label": "{kind}, {date}: {preview}",
	"journal.pickKind": "What do you want to write?",
	"journal.pickHabit": "Which habit?",
	"journal.needsBuildHabit": "Needs a habit you're building",
	"journal.needsHabit": "Needs a habit",
	"journal.needsIdentity": "Needs an identity",
	"journal.makeTask": "Make it a task",
	"journal.taskCreated": "Added to your tasks ✓",
	"journal.applyToHabit": "Make this the habit's plan",
	"journal.habitUpdated": "Habit plan updated",
	"journal.group.quick": "Quick",
	"journal.group.plan": "Plan",
	"journal.group.reflect": "Reflect",
	"journal.group.free": "Free",

	// ── Kinds (Annex J §1.1) ──
	"journal.kind.evidence": "Evidence",
	"journal.kind.evidence.hint": "Proof that you're becoming who you want to be",
	"journal.kind.awareness": "Notice a habit",
	"journal.kind.awareness.hint": "Point it out and call it out: awareness comes before change",
	"journal.kind.recovery": "Comeback plan",
	"journal.kind.recovery.hint": "Never miss twice: plan your next rep",
	"journal.kind.checkin": "Goldilocks check-in",
	"journal.kind.checkin.hint": "Too easy, too hard or just right?",
	"journal.kind.contract": "Habit contract",
	"journal.kind.contract.hint": "Make breaking your promise costly",
	"journal.kind.belief": "Rewrite a belief",
	"journal.kind.belief.hint": "Trade an old story for the identity you're voting for",
	"journal.kind.review": "Review",
	"journal.kind.review.hint": "What went well, what didn't, what you learned",
	"journal.kind.integrity": "Integrity Report",
	"journal.kind.integrity.hint": "Your values, and how well you're living them",
	"journal.kind.note": "Free note",
	"journal.kind.note.hint": "Anything about who you're becoming",

	// ── Lead paragraphs (one book idea per kind) ──
	"journal.lead.evidence":
		"Every action you take is a vote for the type of person you wish to become.",
	"journal.lead.awareness":
		"Awareness comes before change. Does this behavior help you become the person you want to be?",
	"journal.lead.recovery":
		"Missing once is an accident. Missing twice is the start of a new habit. Decide your next rep now.",
	"journal.lead.recoveryBreak":
		"Be kind to yourself: a slip is information, not a verdict. Find the cue, then make it invisible and difficult.",
	"journal.lead.checkin":
		"Motivation peaks on tasks right at the edge of your ability: not too easy, not too hard.",
	"journal.lead.contract":
		"A habit contract makes the cost of breaking a promise public and painful.",
	"journal.lead.belief":
		"Decide the type of person you want to be. Prove it to yourself with small wins.",
	"journal.lead.review":
		"Reflection keeps good habits from going on autopilot. These are the three questions of James Clear's Annual Review.",
	"journal.lead.integrity":
		"Halfway through each year, James Clear writes an Integrity Report: are you living by the values you claim?",
	"journal.lead.note": "Write whatever helps.",

	// ── Prompts: question (label), example (placeholder), hint (helper line) ──
	"journal.prompt.evidence.text": "What did you do that proves it?",
	"journal.example.evidence.text": "Read 10 pages on the bus instead of scrolling.",
	"journal.hint.evidence.text": "Small wins count. Each one is a vote for who you're becoming.",

	"journal.prompt.awareness.behavior": "What did you notice yourself doing?",
	"journal.example.awareness.behavior": "Checked my phone as soon as I woke up",
	"journal.hint.awareness.behavior":
		"Just describe it. No judgment yet: the goal is to see it clearly.",
	"journal.prompt.awareness.rating": "Does it cast a vote for or against who you want to be?",
	"journal.prompt.awareness.say": "Say it out loud: where does it lead?",
	"journal.example.awareness.say": "If I keep scrolling in bed, I'll start tomorrow tired.",
	"journal.hint.awareness.say":
		"Pointing-and-Calling: naming the action and its outcome moves a habit from automatic to conscious.",

	"journal.prompt.recovery.obstacle": "What got in the way?",
	"journal.example.recovery.obstacle": "Worked late and ran out of energy.",
	"journal.hint.recovery.obstacle": "Look at the system, not at yourself: what made skipping easy?",
	"journal.prompt.recovery.when": "When will you do it next?",
	"journal.prompt.recovery.where": "Where will you do it?",
	"journal.example.recovery.where": "in the living room",
	"journal.prompt.recovery.after": "Right after I…",
	"journal.example.recovery.after": "pour my morning coffee",
	"journal.hint.recovery.after": "Habit stacking: tie it to something you already do every day.",
	"journal.prompt.recovery.twoMinute": "On a hard day, the two-minute version is…",
	"journal.example.recovery.twoMinute": "Put on my running shoes",
	"journal.hint.recovery.twoMinute":
		"Make it so easy you can't say no. A habit must be established before it can be improved.",
	"journal.prompt.recovery.trigger": "What triggered it?",
	"journal.example.recovery.trigger": "Phone on the nightstand at 11pm",
	"journal.hint.recovery.trigger":
		"Every habit starts with a cue. Describe the moment just before the slip.",
	"journal.prompt.recovery.cueType": "What kind of cue was it?",
	"journal.prompt.recovery.hide": "How can you make that cue invisible?",
	"journal.example.recovery.hide": "Charge the phone in the kitchen overnight",
	"journal.hint.recovery.hide":
		"Reduce exposure: it's easier to avoid temptation than to resist it.",
	"journal.prompt.recovery.friction": "What friction can you add?",
	"journal.example.recovery.friction": "Log out of the app after each use",
	"journal.hint.recovery.friction": "Make it difficult: put more steps between you and the habit.",
	"journal.recovery.yourPlan": "Your plan",

	"journal.prompt.checkin.difficulty": "How does “{habit}” feel right now?",
	"journal.prompt.checkin.adjust": "What will you change?",
	"journal.example.checkin.adjust": "Keep 10 pages; add a second book for weekends.",
	"journal.hint.checkin.adjust":
		"Small adjustments, not overhauls: stay at the edge of your ability.",

	"journal.prompt.contract.commitment": "I commit to…",
	"journal.example.contract.commitment": "Read 10 pages every night before bed.",
	"journal.prompt.contract.consequence": "If I break it, I will…",
	"journal.example.contract.consequence": "pay $20 to my partner",
	"journal.hint.contract.consequence":
		"Pick a cost you'd really pay and that someone will see. It makes the bad choice unsatisfying.",

	"journal.prompt.belief.oldStory": "A story about yourself that holds you back",
	"journal.example.belief.oldStory": "I'm just not a morning person.",
	"journal.hint.belief.oldStory":
		"You weren't born with this belief. You learned it, so you can unlearn it.",
	"journal.prompt.belief.newStory": "The identity you're voting for instead",
	"journal.example.belief.newStory": "I'm the type of person who starts the day early.",
	"journal.prompt.belief.proof": "One small win that would prove it this week",
	"journal.example.belief.proof": "Wake up at 6:30 on Tuesday.",
	"journal.hint.belief.proof": "Small wins are evidence. Make it a task so it actually happens.",

	"journal.prompt.review.well": "What went well?",
	"journal.example.review.well": "Read every day and finished a book.",
	"journal.prompt.review.notWell": "What didn't go so well?",
	"journal.example.review.notWell": "Skipped two workouts when work got busy.",
	"journal.prompt.review.learned": "What did you learn?",
	"journal.example.review.learned": "Packing the gym bag the night before makes mornings easy.",
	"journal.prompt.review.next": "One adjustment to your system",
	"journal.example.review.next": "Lay out my running clothes on Sunday night",
	"journal.hint.review.next":
		"You fall to the level of your systems: change one small thing about yours.",

	"journal.prompt.integrity.values": "What are the core values that drive your life and work?",
	"journal.example.integrity.values": "Curiosity, health, presence with my family.",
	"journal.prompt.integrity.living": "How are you living and working with integrity right now?",
	"journal.example.integrity.living":
		"Mostly: mornings are calm, but evenings still go to the phone.",
	"journal.prompt.integrity.standard": "How can you set a higher standard in the future?",
	"journal.example.integrity.standard": "Phone out of the bedroom, every night.",

	"journal.prompt.note.text": "What's on your mind?",
	"journal.example.note.text": "Noticed the days I walk to work are calmer.",

	// ── Awareness ──
	"journal.rating.positive": "For",
	"journal.rating.neutral": "Neutral",
	"journal.rating.negative": "Against",
	"journal.awareness.addToScorecard": "Add to my Habits Scorecard",
	"journal.awareness.onScorecard": "On your Scorecard ✓",
	"journal.awareness.added": "Added to your Habits Scorecard",
	"journal.awareness.breakHabit": "Break this habit",

	// ── Goldilocks check-in (Annex J §1.8) ──
	"journal.difficulty.too-easy": "Too easy — I'm bored",
	"journal.difficulty.just-right": "Just right",
	"journal.difficulty.too-hard": "Too hard",
	"journal.goldilocks.raise": "Raise the daily goal to {target}",
	"journal.goldilocks.lower": "Lower the daily goal to {target}",
	"journal.goldilocks.easyTip": "Add a harder version, for example a longer session.",
	"journal.goldilocks.useTwoMinute": "Do just the two-minute version: {twoMinute}",
	"journal.goldilocks.defineTwoMinute": "Define a two-minute version",
	"journal.goldilocks.hard":
		"Scale it down until it's easy to start. A habit must be established before it can be improved.",
	"journal.goldilocks.right":
		"Just right. When it gets boring, keep showing up: professionals stick to the schedule.",
	"journal.goldilocks.easy":
		"The greatest threat to success is not failure but boredom. Make it a little harder.",
	"journal.goldilocks.applied": "Daily goal updated",

	// ── Habit contract (Annex J §1.9) ──
	"journal.contract.commitmentDefault": "I will {habit}, {schedule}.",
	"journal.contract.commitmentDays": "I will {habit} on these days: {days}.",
	"journal.contract.partner": "Accountability partner",
	"journal.contract.partnerPlaceholder": "Someone who will hold you to it",
	"journal.contract.until": "Until",
	"journal.contract.sign": "Sign contract",
	"journal.contract.signHint": "Fill in the commitment, the consequence and the end date to sign.",
	"journal.contract.signedToast": "Contract signed. Now share it with your partner.",
	"journal.contract.revoke": "Revoke signature",
	"journal.contract.locked": "Signed contracts are locked. Revoke the signature to edit.",
	"journal.contract.signed": "Signed {date}",
	"journal.contract.active": "Active until {date}",
	"journal.contract.draft": "Draft",
	"journal.contract.ended": "Ended",
	"journal.contract.kept": "Kept",
	"journal.contract.broken": "Broken",
	"journal.contract.keptAction": "I kept it",
	"journal.contract.brokenAction": "I broke it",
	"journal.contract.share": "Share with your partner",
	"journal.contract.copied": "Contract copied",
	"journal.contract.textTitle": "Habit contract",
	"journal.contract.textConsequence": "If I break it: {consequence}",
	"journal.contract.textUntil": "Valid until {until}.",
	"journal.contract.textSigned": "Signed: {name}, {date}",
	"journal.contract.textSignedNoName": "Signed on {date}",
	"journal.contract.textUnsigned": "Not signed yet.",
	"journal.contract.textPartner": "Accountability partner: {partner}",

	// ── Reviews, ranges and the snapshot (Annex J §1.6, §1.7) ──
	"journal.review.scope.week": "Weekly review",
	"journal.review.scope.month": "Monthly review",
	"journal.review.scope.year": "Annual Review",
	"journal.review.previous": "Previous period",
	"journal.review.next": "Next period",
	"journal.range.week": "Week of {date}",
	"journal.range.span": "{from} – {to}",
	"journal.snapshot.title": "The numbers",
	"journal.snapshot.votes": "Votes cast",
	"journal.snapshot.consistency": "Consistency",
	"journal.snapshot.perfectDays": "Perfect days",
	"journal.snapshot.slips": "Slips",
	"journal.snapshot.evidence": "Evidence written",
	"journal.snapshot.byIdentity": "Votes by identity",
	"journal.snapshot.top": "Most consistent",
	"journal.snapshot.ofDue": "{done} of {due}",
	"journal.snapshot.missedTwice": "Missed twice in a row: {habits}",
	"journal.snapshot.neverMissedTwice": "You never missed twice.",
	"journal.snapshot.empty": "Nothing was tracked in this period.",

	// ── Today: the journal nudge (Annex J §1.5) ──
	"journal.nudge.dismiss": "Not now",
	"journal.nudge.dismissLabel": "Dismiss: {title}",
	"journal.nudge.slip.title": "What triggered it?",
	"journal.nudge.slip.body":
		"You logged a slip on {habit}. Two minutes of reflection makes the cue easier to spot next time.",
	"journal.nudge.slip.cta": "Reflect",
	"journal.nudge.contract.title": "Contract ended",
	"journal.nudge.contract.body": "Your contract for {habit} ended {date}. Did you keep it?",
	"journal.nudge.contract.open": "Open",
	"journal.nudge.review.body":
		"Three questions, three minutes: what went well, what didn't, what you learned.",
	"journal.nudge.review.cta": "Start review",
	"journal.nudge.year.body": "Look back on {year}: the votes you cast and the person they built.",
	"journal.nudge.integrity.body": "Halfway through the year: are you living the values you claim?",
	"journal.nudge.integrity.cta": "Start",
	"journal.nudge.evidence.title": "Collect your evidence",
	"journal.nudge.evidence.body":
		"You cast {votes} votes for “{identity}” this week. Write one down as proof.",
	"journal.nudge.evidence.cta": "Write evidence",

	// ── Today banners and the perfect-day card ──
	"journal.nmt.plan": "Plan the comeback",
	"journal.nmt.freshPlan": "Plan a fresh start",
	"journal.nmt.yourPlan": "Your plan: {plan}",
	"journal.nmt.editPlan": "Edit plan",
	"journal.nmt.planSaved": "Plan saved",
	"journal.proof.cta": "Write down the proof",

	// ── Habit detail: check-in prompt and the journal section ──
	"journal.checkin.strong.title": "Still the right size?",
	"journal.checkin.strong.body":
		"{habit} is getting automatic. Habits that are too easy get boring. Check in.",
	"journal.checkin.struggling.title": "Is {habit} too hard right now?",
	"journal.checkin.struggling.body": "Scaling it down is not quitting. Check in and adjust.",
	"journal.checkin.cta": "Check in",
	"journal.habit.title": "Journal & notes",
	"journal.habit.empty": "Plans, check-ins and notes for this habit show up here.",
	"journal.habit.seeAll": "See all in Journal",
	"journal.habit.contract": "Habit contract · active until {date}",
	"journal.habit.contractWith": "Habit contract · active until {date} · with {partner}",

	// ── Identity: evidence count, quick evidence, values card ──
	"journal.evidence.count.one": "{count} piece of evidence",
	"journal.evidence.count.other": "{count} pieces of evidence",
	"journal.evidence.quickPlaceholder": "What did you do today that proves it?",
	"journal.evidence.quickLabel": "Evidence for “{identity}”",
	"journal.evidence.added": "Evidence saved. Proof adds up.",
	"journal.evidence.add": "Evidence",
	"journal.values.title": "Your values",
	"journal.values.updated": "From your Integrity Report, {date}",
} as const;
