import { Eye, EyeOff } from "@/components/icons";
import { PressableScale } from "@/components/ui/pressable-scale";
import { TextField, type TextFieldProps } from "@/components/ui/text-field";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { forwardRef, useState } from "react";
import type { TextInput } from "react-native";

/**
 * A password field with a show/hide toggle ("Show password", a toggle
 * button whose state is read out). Autofill hints come from the caller.
 * Owner: T5.
 */
export const PasswordField = forwardRef<TextInput, Omit<TextFieldProps, "secureTextEntry">>(
	function PasswordField(props, ref) {
		const t = useT();
		const { colors } = useTheme();
		const [visible, setVisible] = useState(false);
		return (
			<TextField
				ref={ref}
				autoCapitalize="none"
				autoCorrect={false}
				spellCheck={false}
				{...props}
				secureTextEntry={!visible}
				right={
					<PressableScale
						onPress={() => setVisible((v) => !v)}
						scaleTo={0.9}
						hitSlop={6}
						accessibilityRole="button"
						accessibilityLabel={t.t("account.showPassword")}
						accessibilityState={{ selected: visible }}
						style={{
							width: 36,
							height: 36,
							marginRight: -8,
							alignItems: "center",
							justifyContent: "center",
						}}
					>
						{visible ? (
							<EyeOff size={18} color={colors.textMuted} strokeWidth={1.9} />
						) : (
							<Eye size={18} color={colors.textMuted} strokeWidth={1.9} />
						)}
					</PressableScale>
				}
			/>
		);
	},
);
