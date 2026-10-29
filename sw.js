// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER — Guardião - Ronda Master
// ═══════════════════════════════════════════════════════════════
// Isso é o que garante que o app abra e funcione sem internet,
// depois de já ter sido aberto uma vez com internet (para guardar a cópia).
//
// IMPORTANTE EM ATUALIZAÇÕES FUTURAS: toda vez que o rondamaster.html
// ganhar uma nova versão (v3.2, v3.3...), o número CACHE_VERSAO aqui
// embaixo TEM que subir junto — senão o celular continua preso na versão
// antiga guardada no cache.
// ═══════════════════════════════════════════════════════════════

const CACHE_VERSAO = 'v3.1'; // <-- Sobe esse número a cada nova versão do sistema
const CACHE_NOME = 'guardiao-ronda-master-' + CACHE_VERSAO;

// Se a internet demorar mais que isso para responder, usa a cópia guardada
// (internet "fraca" não pode travar a abertura do app)
const LIMITE_REDE_MS = 4000;

const URL_PRINCIPAL = new URL('./rondamaster.html', self.location).href;

// Arquivos do próprio app (mesma origem). Só o principal é obrigatório;
// os demais são guardados "se der", sem derrubar a instalação.
const ARQUIVOS_OPCIONAIS = [
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Bibliotecas externas (versão fixa no endereço, nunca mudam)
const ARQUIVOS_EXTERNOS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

function redeComLimite(requisicao, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rede lenta')), ms);
    fetch(requisicao).then(
      r => { clearTimeout(t); resolve(r); },
      e => { clearTimeout(t); reject(e); }
    );
  });
}

// ─── INSTALAÇÃO ───
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NOME).then(async cache => {
      // O app principal é essencial: se falhar, a instalação falha e tenta de novo depois
      await cache.add(new Request(URL_PRINCIPAL, { cache: 'reload' }));
      // O resto: tenta guardar cada um, sem travar se algum falhar
      await Promise.all(
        ARQUIVOS_OPCIONAIS.concat(ARQUIVOS_EXTERNOS).map(url =>
          cache.add(url).catch(erro => console.warn('[SW] Não guardei (tenta depois):', url, erro))
        )
      );
    })
  );
  self.skipWaiting();
});

// ─── ATIVAÇÃO: apaga caches de versões antigas ───
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(nomes =>
      Promise.all(
        nomes
          .filter(n => n.startsWith('guardiao-ronda-master-') && n !== CACHE_NOME)
          .map(n => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── BUSCA ───
self.addEventListener('fetch', event => {
  const req = event.request;
  // Só GET. Chamadas do Firestore (POST etc.) passam direto, sem interferência.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const mesmaOrigem = url.origin === self.location.origin;

  // 1) Abrir o app (inclui endereço sem o nome do arquivo e com ?parâmetros)
  const ehAbertura = req.mode === 'navigate' ||
    (mesmaOrigem && (url.pathname.endsWith('/rondamaster.html') || url.pathname.endsWith('/')));
  if (ehAbertura && mesmaOrigem) {
    event.respondWith(
      redeComLimite(req, LIMITE_REDE_MS)
        .then(resp => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE_NOME).then(c => c.put(URL_PRINCIPAL, copia)).catch(() => {});
          }
          return resp;
        })
        .catch(() =>
          caches.match(URL_PRINCIPAL).then(c => c ||
            new Response('<meta charset="utf-8"><h3>Sem internet e o app ainda não foi guardado neste aparelho.</h3><p>Conecte-se uma vez para abrir o Guardião.</p>',
              { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }))
        )
    );
    return;
  }

  // 2) Outros arquivos do app (ícones, manifest): rede primeiro, cópia guardada como reserva
  if (mesmaOrigem) {
    event.respondWith(
      redeComLimite(req, LIMITE_REDE_MS)
        .then(resp => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE_NOME).then(c => c.put(req, copia)).catch(() => {});
          }
          return resp;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then(c => c || Response.error()))
    );
    return;
  }

  // 3) Bibliotecas externas (Firebase, jsPDF): cópia guardada primeiro; se faltar, busca e guarda
  if (ARQUIVOS_EXTERNOS.includes(req.url)) {
    event.respondWith(
      caches.match(req).then(guardado => {
        if (guardado) return guardado;
        return fetch(req).then(resp => {
          const copia = resp.clone();
          caches.open(CACHE_NOME).then(c => c.put(req, copia)).catch(() => {});
          return resp;
        });
      })
    );
  }
  // Qualquer outro pedido (Firestore etc.) segue o comportamento normal do navegador.
});
