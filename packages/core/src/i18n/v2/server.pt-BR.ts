import type { serverEn } from "./server.en";

export const serverPtBR: Record<keyof typeof serverEn, string> = {
	"email.verify.subject": "Confirme seu e-mail no Atomic",
	"email.verify.body":
		"Oi, {name}! Confirme que este é o seu e-mail para sempre conseguir recuperar sua conta.",
	"email.verify.cta": "Confirmar e-mail",
	"email.verify.ignore": "Se você não criou uma conta no Atomic, pode ignorar este e-mail.",
	"email.reset.subject": "Redefina sua senha do Atomic",
	"email.reset.body":
		"Alguém pediu para redefinir a senha de {email}. O link expira em 1 hora. Se não foi você, ignore este e-mail.",
	"email.reset.cta": "Escolher nova senha",
	"email.linkFallback": "Se o botão não funcionar, copie este link no navegador:",
	"email.footer":
		"Você recebeu isto por causa da sua conta no Atomic. O Atomic nunca pede sua senha por e-mail.",
	"page.reset.title": "Escolha uma nova senha",
	"page.reset.password": "Nova senha",
	"page.reset.confirm": "Repita a nova senha",
	"page.reset.hint": "Pelo menos {min} caracteres.",
	"page.reset.mismatch": "As senhas não são iguais.",
	"page.reset.tooShort": "Use pelo menos {min} caracteres.",
	"page.reset.tooLong": "Use no máximo {max} caracteres.",
	"page.reset.submit": "Salvar nova senha",
	"page.reset.done": "Senha alterada. Entre de novo nos seus aparelhos.",
	"page.reset.invalid": "Este link expirou ou já foi usado. Peça um novo pelo app.",
	"page.verified.title": "E-mail confirmado",
	"page.verified.body": "Você já pode voltar para o Atomic.",
	"page.verified.failed": "Este link expirou. Envie um novo pelo app.",
	"page.export.invalid": "Este link de download expirou ou já foi usado. Peça um novo pelo app.",
	"page.linkExpired": "Link expirado",
	"page.tooMany": "Muitas tentativas. Tente de novo em um minuto.",
	"page.billing.success": "Pagamento recebido. Seu plano atualiza em alguns segundos.",
	"page.billing.cancel": "Pagamento cancelado. Nada foi cobrado.",
	"page.openApp": "Abrir o Atomic",
	"page.close": "Você já pode fechar esta aba.",
};
