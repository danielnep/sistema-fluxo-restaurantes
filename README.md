# Sistema de Restaurantes · Operação (nome comercial a definir)

**Estado:** versão web de testes v0.2, com aplicação por papéis, persistência SQLite, rede local, contingência e sincronização cloud; sem APK e sem publicação em produção.

## Arquitetura

O **terminal central** executa `server.mjs` e guarda os dados em SQLite local com WAL. Celulares conectados ao **mesmo Wi-Fi** abrem pelo navegador `http://IP-DO-CAIXA:3050`. O roteador não precisa ter acesso à internet para pedidos, fila da cozinha e chamadas em telas abertas. O terminal central precisa estar ligado e acessível.

Opcionalmente, uma segunda instância do mesmo servidor é implantada na nuvem com `MODE=cloud`. O terminal local envia cópias consistentes de usuários, pedidos, itens, produtos, presenças e histórico por HTTPS com `CLOUD_SYNC_URL` + `SYNC_TOKEN`; se não houver internet, a sincronização aguarda. O gerente entra na nuvem e vê os **últimos dados sincronizados**, em modo somente leitura. O ambiente remoto exige TLS e controles de acesso próprios. O modelo atual é de **um hub por instância de nuvem**, não permite múltiplas lojas no mesmo banco.

O SQLite do caixa é o banco operacional principal. Não executar duas cópias independentes do servidor local para o mesmo restaurante. O espelho remoto não substitui backup nem restauração testada.

## Execução

Node.js 22+ e nenhum pacote npm externo.

```sh
# Primeira inicialização: exige senha de gerência
ADMIN_PASSWORD='uma-senha-segura' npm start
# Acesse http://localhost:3050 no computador central
```

**Demonstração somente em ambiente isolado:**

```sh
DEMO_MODE=1 npm start
```

Contas de demonstração: `admin`, `cozinha`, `caixa`, `carlos`, `marina`; senha de todas: `demo1234`. **Nunca iniciar DEMO_MODE em produção.** A demonstração inclui cardápio fictício; essas contas existem apenas em bancos novos e isolados. SQLite atual do Node 22 ainda em estado experimental.

## Melhorias v0.2

- Gerência pode registrar a chegada de garçom sem celular na tela Equipe; cozinha confirma e ele fica marcado "sem aparelho".
- Avisos de disponibilidade ficam registrados por funcionário até a leitura, com contador na navegação.
- Pedidos têm identificador único para evitar duplicação quando a conexão falha após o envio.
- Garçom consegue acionar Disponível/Ocupado/Pausa; mudanças reencaminham chamadas pendentes.
- Chamados no caixa não são recriados em loop; escritas externas bloqueadas por verificação da origem.

## Fluxos implementados

- Gerência com login/senha. Funcionários por credenciais pessoais e cadastro de garçom com aprovação administrativa.
- Garçom marca **Cheguei**; cozinha ou gerência confirma a presença. Identidade e pedidos permanecem no servidor, podendo trocar de dispositivo.
- Cozinha móvel: fila em tempo real com preparar → pronto; habilitar/desabilitar produtos.
- Novo pedido: garçom e mesa, busca, categorias, favoritos por volume vendido, quantidade, notas por item e observação geral. Revalidação de disponibilidade no servidor.
- Terminal central compartilha a estação sem alternar contas e registra responsável / operador separadamente.
- Roteador: distribui a primeira retirada para o garçom disponível, confirmado e recentemente conectado que recebeu chamado há mais tempo. Se não houver, atribui ao terminal central. Expira sem confirmação após 45 s, redistribui ou encaminha à central.
- Dashboard gerencial ao vivo, histórico/auditoria e insights determinísticos (mais pedidos, itens populares indisponíveis, atrasos de retirada).
- Telemetria de conectividade e bateria quando informada pelo dispositivo.
- Sincronização periódica **somente local → nuvem**, por transferência de snapshot idempotente. As operações locais não param por falta de internet.

## Restrições importantes

1. **Sem APK nesta fase**: navegador não entrega as mesmas garantias de vibração, monitoramento de bateria, notificações de tela bloqueada e execução em segundo plano de um app Android nativo. Esta versão é para testar fluxos, dados e interface. Esses recursos exigem etapa posterior de APK/Android.
2. Na rede local, HTTPS e certificado confiável são recomendados para uso operacional; cookies de sessão neste protótipo LAN ainda podem circular em HTTP. **Não usar em produção com dados reais sem configurar HTTPS**, controle de rede e endurecimento de segurança.
3. Nuvem não foi provisionada. Configurar hospedagem persistente, TLS, segredos, backups, monitoramento, limites de requisições e política de restauração antes de colocar clientes.
4. Filtros gerenciais são inicialmente operacionais, não representam contabilidade/faturamento nem integração fiscal. Não há PDV ou pagamento nesta versão.
5. Reconciliação de múltiplos hubs, operação simultânea em vários locais, notificações nativas push, fila de múltiplos setores e sincronização bidirecional não foram implementadas.
6. Bateria via `navigator.getBattery()` não está disponível em todos os navegadores; o APK futuro utilizará API nativa e permissões adequadas. Leitura desatualizada não prova a bateria atual.
7. O modo nuvem replica hashes de senha do banco local pelo canal HTTPS autenticado. Segredos devem ser fortes, únicos e mantidos fora do código e do repositório.

## Testes

```sh
npm test
```

## Próxima etapa técnica

Endurecimento para produção (segurança HTTP, armazenamento, backup/restore), Android APK nativo com push/vibração, comunicação local persistente e supervisão da conexão, monitoramento real de bateria; homologação com múltiplos telefones e restaurante piloto.

### Operação com mais de um restaurante

Para a primeira implementação, cada estabelecimento possui seu próprio hub e seu próprio destino cloud configurado. Um painel multicliente Horizon com tenants isolados ainda não faz parte desta entrega.

### Execução por Docker

```sh
docker build -t sistema-fluxo-restaurantes .
docker run -p 3050:3050 -v fluxo-data:/data \
  -e ADMIN_PASSWORD='senha-inicial-forte' sistema-fluxo-restaurantes
```

