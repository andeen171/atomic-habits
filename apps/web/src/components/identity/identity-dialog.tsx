import { useT } from "@/lib/messages";
import type { Identity } from "@atomic/core";
import { useActions } from "@atomic/core/react";
import { type FormEvent, useState } from "react";
import { AiSuggest } from "../ai/ai-suggest";
import { ColorPicker, EmojiPicker } from "../editor/editor-fields";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../ui/dialog";
import { Field } from "../ui/field";
import { SmartInput } from "../ui/smart-input";

interface IdentityDialogProps {
	open: boolean;
	onOpenChange(open: boolean): void;
	identity: Identity;
}

export function IdentityDialog({ open, onOpenChange, identity }: IdentityDialogProps) {
	const { at } = useT();
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent size="sm">
				<DialogHeader title={at("identity.edit")} />
				{open ? <IdentityForm identity={identity} onDone={() => onOpenChange(false)} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function IdentityForm({ identity, onDone }: { identity: Identity; onDone(): void }) {
	const { t } = useT();
	const actions = useActions();
	const [statement, setStatement] = useState(identity.statement);
	const [emoji, setEmoji] = useState(identity.emoji);
	const [color, setColor] = useState(identity.color);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!statement.trim()) return;
		actions.updateIdentity(identity.id, { statement, emoji, color });
		onDone();
	};

	return (
		<form onSubmit={submit} className="flex min-h-0 flex-col">
			<DialogBody className="flex flex-col gap-5">
				<Field label={t("form.identity")}>
					{(props) => (
						<div className="flex items-center gap-2.5">
							<EmojiPicker value={emoji} color={color} onChange={setEmoji} />
							<SmartInput
								{...props}
								field="identity.statement"
								value={statement}
								maxLength={120}
								placeholder={t("identity.placeholder")}
								onChange={(event) => setStatement(event.target.value)}
							/>
							<AiSuggest
								kind="identity.statement"
								label={t("form.identity")}
								input={() => ({ goal: statement.trim() })}
								onPick={setStatement}
							/>
						</div>
					)}
				</Field>
				<div className="flex flex-col gap-2">
					<span className="font-medium text-ink text-small">{t("form.color")}</span>
					<ColorPicker value={color} onChange={setColor} />
				</div>
			</DialogBody>
			<DialogFooter>
				<Button variant="secondary" onClick={onDone}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" disabled={!statement.trim()}>
					{t("common.save")}
				</Button>
			</DialogFooter>
		</form>
	);
}
