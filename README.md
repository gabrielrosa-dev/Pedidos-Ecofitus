# Pedidos Ecofitus

Loja com catálogo, consulta de razão social, histórico privado e pedido por WhatsApp. A interface é publicada no GitHub Pages e pode usar Google Apps Script e uma planilha privada como serviço de pedidos, sem servidor Windows. O GitHub Pages não executa código no servidor nem grava pedidos por conta própria.

## Estrutura

- `public/`: interface, campanhas e arquivos de instalação publicados pelo GitHub Pages.
- `apps-script/`: integração com Google Planilhas e arquivos gerados com as regras compartilhadas.
- `test/`: testes automatizados.
- `server.js`, `catalog.js`, `orders.js`, `registry.js`, `sync-catalog.ps1` e `admin/`: alternativa de servidor local.
- `data/`: cache e pedidos locais; permanece fora do repositório. A pasta original `Campanhas/` também fica local; o site usa as imagens selecionadas em `public/images/campaigns/`.

O arquivo de cache `data/catalog.json` constava em uma versão antiga do repositório público. Sua remoção da versão atual não remove cópias anteriores do histórico Git; não armazene pedidos ou informações privadas no repositório.

## Configurar Google Planilhas e Apps Script

1. Crie uma planilha Google e mantenha o compartilhamento **restrito** à equipe comercial. O ID é o trecho entre `/d/` e `/edit` no endereço da planilha. Não publique a planilha nem coloque informações de compradores no GitHub.
2. Na planilha, abra **Extensões → Apps Script**. No editor, cole o conteúdo de `apps-script/Code.gs` no arquivo de código principal e substitua `COLE_O_ID_DA_PLANILHA_AQUI` pelo ID da sua planilha. `PARENT_ORIGIN` deve continuar sendo `https://gabrielrosa-dev.github.io`, a menos que o site mude de domínio.
3. Crie mais dois arquivos de script no editor, chamados `Campaigns` e `Catalog`, e cole respectivamente os conteúdos de `apps-script/Campaigns.gs` e `apps-script/Catalog.gs`. Esses arquivos são gerados a partir das regras usadas pela loja; ao mudar as regras, execute `node apps-script/build.js` e atualize os arquivos no Apps Script antes de implantar uma nova versão.
4. Salve o projeto e execute a função **setup** uma vez no editor, autorizando os acessos solicitados pelo Google após verificar o código. Ela cria a aba `Pedidos`; a planilha é usada apenas para o histórico. O Google pode apresentar uma tela de aplicativo não verificado; conceda permissões somente se você conferir e confiar no código.
5. Selecione **Implantar → Nova implantação → App da Web**, configure **Executar como: eu** e **Quem pode acessar: qualquer pessoa**, e implante. A disponibilidade dessa opção depende das regras da conta Google. Copie a URL terminada em `/exec`. O endpoint deve ser público para receber pedidos, mas a planilha não deve ser compartilhada publicamente.
6. Informe ao responsável pela publicação a URL `/exec` (ela não é senha) para preencher `ECOFITUS_SCRIPT_URL` em `public/config.js` e republicar o Pages. Não envie senhas nem chaves. A implantação existente não recebe atualizações de código automaticamente: após alterar scripts, atualize a implantação para uma nova versão.
7. Teste uma consulta de CNPJ, uma campanha e um pedido real de teste, confirme uma linha na aba `Pedidos`, e verifique a mensagem preparada no WhatsApp. O histórico fica diretamente na planilha, não na antiga página `/admin`.

O Google Apps Script tem limites de execução, armazenamento e requisições. A atualização é feita **sob demanda**: a primeira consulta após cinco minutos atualiza o catálogo; falhas e limites impedem a preparação do pedido até a próxima consulta bem-sucedida. Não há garantia de atualização a cada cinco minutos exatos. O serviço público pode receber solicitações indevidas; monitore os registros e as cotas e, para operação de maior volume, use um backend com proteção contra abuso e autenticação apropriada.

## Alternativa: executar o servidor Node local

## Executar no Windows

Requisitos: Node.js 18 ou superior e Windows PowerShell. Defina uma senha forte e única de pelo menos 16 caracteres em variável de ambiente, fora do código e do repositório, e execute:

```powershell
$env:ADMIN_PASSWORD = '<defina-uma-senha-forte>'
node server.js
```

Abra `http://localhost:3000`. O histórico está em `http://localhost:3000/admin`, usuário `admin` e a senha configurada. Sem essa senha, a preparação de pedidos e o histórico são bloqueados. O servidor usa a porta 3000 e escuta todas as interfaces; configure `HOST` e `PORT` conforme necessário.

## Alternativa: publicar com backend Node

1. Hospede o backend em um servidor Windows com processo permanentemente ativo, armazenamento persistente e proxy reverso HTTPS. Restrinja a porta Node à interface interna. Nunca exponha a área administrativa por HTTP: a autenticação Basic só é segura com TLS. Proteja também o acesso ao servidor e à pasta de dados; aplique restrição de acesso e proteção contra tentativas de login no proxy.
2. No servidor configure `ADMIN_PASSWORD`, `HOST=127.0.0.1`, `ALLOWED_ORIGIN=https://gabrielrosa-dev.github.io` e opcionalmente `ORDERS_DIR` para uma pasta privada, persistente e com permissões restritas. O proxy deve encaminhar `/api/*`, `/admin`, `/admin.js`, `/styles.css` e `/extra.css` ao backend. Faça cópias de segurança protegidas dos pedidos. Não inclua `data` ou a pasta `ORDERS_DIR` no Git.
3. Em `public/config.js`, substitua o valor vazio pela origem HTTPS do backend, por exemplo `https://api.exemplo.com` (sem barra final). Não coloque senhas nesse arquivo.
4. Envie o código ao repositório e selecione **Settings → Pages → Build and deployment → Source: GitHub Actions**. O workflow publica somente `public/`. O Pages, por si só, não salva pedidos, consulta a BrasilAPI nem executa a sincronização PowerShell.
5. Acesse o histórico em `https://<endereço-do-backend>/admin`, nunca no Pages. Teste o fluxo completo e faça um pedido de teste antes da divulgação.

O workflow publica somente o frontend; não hospeda o backend Node nem cria o Apps Script.

## Funcionamento e limitações

- O CNPJ fixo no `sync-catalog.ps1` é usado **somente** para consultar o catálogo Nexfar 2773. O catálogo 2771 retornou indisponível. O CNPJ informado pelo comprador é independente dele.
- As cinco campanhas fornecidas aparecem em um carrossel automático. Cada banner abre um exemplo fixo, que pode ser adicionado ao carrinho se houver estoque suficiente, inclusive para unidades bonificadas. Os exemplos de mistura e brinde são apenas uma das combinações possíveis; não há seleção de outras opções. A campanha do chopp usa R$ 24,99 por unidade e a do Regulax usa R$ 19,12, conforme os banners; as demais usam preços atuais do catálogo. O Pix não é abatido do total e brindes, bonificações, pagamentos, preços e validade da campanha estão sujeitos à confirmação comercial. Os exemplos e as regras ficam em `public/campaigns.js`, compartilhadas com o servidor; revise-as quando uma campanha mudar ou expirar. As imagens publicadas estão em `public/images/campaigns`; para alterá-las, atualize também os slides em `public/index.html` e, para execução local, os caminhos permitidos em `server.js`. A inclusão de arquivos na pasta `Campanhas` não os publica automaticamente.
- A loja pode ser instalada como aplicativo web (PWA) em navegadores compatíveis no computador e no celular. A instalação precisa de HTTPS (ou localhost para testes). No iPhone/iPad, use Safari → Compartilhar → Adicionar à Tela de Início; outros navegadores podem exigir o menu de instalação. O aplicativo não é distribuído pelas lojas de aplicativos. Sem internet, ele exibe uma página informativa: catálogo, consulta de CNPJ e pedidos exigem conexão e não são armazenados para uso offline.
- A razão social é consultada automaticamente quando o comprador completa o CNPJ, pela BrasilAPI, um serviço de terceiros baseado em dados públicos; não é uma consulta direta à API oficial da Receita e pode ter defasagem ou indisponibilidade. O backend valida novamente o CNPJ e consulta a razão social ao preparar o pedido; se a consulta falhar, o pedido não é preparado. A autorização do prazo continua sendo conferida manualmente.
- Com Apps Script, os produtos e preços são buscados diretamente na Nexfar e mantidos temporariamente no cache do Apps Script por até cinco minutos, sem gravá-los na planilha ou em arquivos do Drive. Se o cache expirar ou for descartado antes, a próxima consulta busca novamente na Nexfar. Com o servidor Node, o catálogo é consultado ao iniciar e a cada cinco minutos; o último resultado fica em `data/catalog.json` e pedidos são bloqueados se o cache tiver mais de dez minutos.
- Fora das campanhas, o preço unitário é o `finalPrice` da tabela normal da API, sem promoções, preços subsidiados, negociações ou frete. A consulta utiliza o CNPJ fixo e não calcula preços específicos do comprador. Os preços e o estoque estão sujeitos a confirmação comercial.
- O mínimo é R$ 50,00. O servidor recalcula os valores e verifica estoque e múltiplos de venda; isso não reserva estoque.
- Ao preparar o pedido, o serviço salva CNPJ, razão social, prazo, produtos, quantidades, preços, número, data e mensagem completa antes de gerar o link do WhatsApp. O histórico é privado e separado dos arquivos publicados no Pages. A gravação é obrigatória: se falhar, o pedido não é preparado. Tentativas com o mesmo identificador e dados reaproveitam o pedido salvo.
- O cliente precisa clicar no link e confirmar o envio no WhatsApp. O histórico comprova apenas que o pedido foi preparado, **não** que a mensagem foi enviada ou recebida. A equipe pode recuperar a mensagem na área administrativa.
- O histórico contém dados comerciais: mantenha backups, controle de acesso, política de retenção e uma política de privacidade adequados. Com Apps Script, fica na planilha privada; com Node, fica por padrão em `data/orders` e deve usar volume persistente privado.

## Testes

```powershell
node --test
```
