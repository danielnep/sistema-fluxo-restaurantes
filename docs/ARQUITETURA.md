# Sistema de Restaurantes · Arquitetura e contratos

## Origem operacional única

Em cada restaurante há **um hub local ativo** (preferencialmente computador no caixa, que permaneça ligado), executando HTTP, a API e o banco SQLite. Todo navegador em um Android na mesma rede local consulta esse hub. Sem WAN, pedidos e filas continuam sincronizados por Server-Sent Events na rede Wi-Fi. Sem o hub, o sistema local fica indisponível: é necessária redundância na próxima fase.

```text
[Garçons] [Cozinha] [Caixa] [Gerência presencial]
      \       |        |       /
             [Roteador Wi-Fi]
                    |
        [Servidor local + SQLite]
                    |
        [HTTPS quando houver WAN]
                    |
       [Espelho cloud + gerência remota]
```

## Estados

- `users`: `approved` e `active` controlam cadastro e acesso.
- `shifts`: `pending` → cozinha/gerência confirma `confirmed_at` → `available` / `busy` / `break` / `no_device` → `end_at`.
- `orders`: `new` → `preparing` → `ready` → `delivered`. Cancelamento permitido apenas antes de `ready` e por cozinha/gerência.
- `dispatches`: `pending` → `acknowledged` → `completed`, ou `expired` após timeout e nova atribuição.
- Produtos indisponíveis: permanecem no cardápio, porém com adição bloqueada; servidor revalida no envio do pedido.

## Regras do roteador

Seleciona trabalhador com turno confirmado, disponibilidade e sinal recente (<90 s), priorizando quem recebeu chamados há mais tempo. Ao terminar pedido cria um despacho. Sem candidato, a chamada vai ao terminal central; após 45 s sem confirmação, expira e é redistribuída. O roteador opera inteiramente no hub, não depende de nuvem ou acesso externo.

## Sincronização

A nuvem é **espelho de leitura**, com a revisão mais recente recebida do hub. Um processo no hub compara revisões a cada 20 s, enviando snapshot por HTTPS autenticado com token secreto. O receptor ignora revisões iguais ou antigas. Se cair a internet, nenhuma operação local é perdida; a cópia remota fica desatualizada até a reconexão. Este protocolo é inicial e deve evoluir para deltas, limites de retenção, compressão e backup automatizado antes de muitos restaurantes.

## Segurança

Senhas: `scrypt` com salt aleatório. Sessões: token aleatório, armazenado pelo hash no banco, cookie HttpOnly, SameSite=Lax, expiração de 14 dias, invalidação da sessão antiga do garçom ao login em outro aparelho. Regras de autorização no servidor. Operações auditadas com usuário, data e objeto. O token de sincronização não deve ficar no frontend.

**Bloqueadores de produção:** TLS obrigatório na rede local e cloud, rate limits completos, testes multiaparelhos em hardware Android, push nativo em segundo plano, backups e restauração, segurança de endpoint, autenticação/infra multi-lojas, coordenação resiliente do hub, política de armazenamento.
