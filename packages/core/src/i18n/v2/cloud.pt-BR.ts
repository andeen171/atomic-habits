import type { cloudEn } from "./cloud.en";

export const cloudPtBR: Record<keyof typeof cloudEn, string> = {
	"sync.persistError": "O Atomic não conseguiu salvar neste dispositivo. Exporte um backup agora.",
	"sync.superseded": "Editado numa versão mais nova do Atomic — atualize para editar.",
	"sync.supersededCount.one": "{count} item precisa de uma versão mais nova",
	"sync.supersededCount.other": "{count} itens precisam de uma versão mais nova",
	"sync.rejectedCount.one": "{count} alteração não pôde ser salva no servidor",
	"sync.rejectedCount.other": "{count} alterações não puderam ser salvas no servidor",
	"sync.journal": "Sincronizar diário",
	"sync.journalHint":
		"Desativado: as entradas escritas neste dispositivo ficam nele. As dos seus outros dispositivos continuam chegando.",
	"sync.quotaFull":
		"O armazenamento de sincronização está cheio. As novas alterações ficam neste dispositivo.",
};
