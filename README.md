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
4. Salve o projeto e execute a função **setup** uma vez no editor, autorizando os acessos solicitados pelo Google após verificar o código. Ela cria ou confirma a aba `Pedidos` e a aba privada `Representantes`; a planilha continua sendo o histórico. Cadastre na aba `Representantes`, sem compartilhar a planilha, as quatro colunas `E-mail`, `Representante`, `Salt` e `Hash da senha`. O identificador do representante deve ser `gabriel` ou `vanderson`. Nunca coloque senhas em texto puro nessa aba. Depois execute **checkSetup**: ela verifica as abas, o formato do WhatsApp e a consulta ao catálogo, sem criar um pedido. Confira no registro de execução a quantidade de produtos. Essa verificação não confirma o destinatário do WhatsApp nem substitui um pedido de teste. O Google pode apresentar uma tela de aplicativo não verificado; conceda permissões somente se você conferir e confiar no código.
5. Selecione **Implantar → Nova implantação → App da Web**, configure **Executar como: eu** e **Quem pode acessar: qualquer pessoa**, e implante. A disponibilidade dessa opção depende das regras da conta Google. Copie a URL terminada em `/exec`. O endpoint deve ser público para receber pedidos, mas a planilha não deve ser compartilhada publicamente.
6. Informe ao responsável pela publicação a URL `/exec` (ela não é senha) para preencher `ECOFITUS_SCRIPT_URL` em `public/config.js` e republicar o Pages. Não envie senhas nem chaves. A implantação existente não recebe atualizações de código automaticamente: após alterar scripts, atualize a implantação para uma nova versão.
7. Teste uma consulta de CNPJ, uma campanha e um pedido real de teste, confirme uma linha na aba `Pedidos`, e verifique a mensagem preparada no WhatsApp. O histórico fica diretamente na planilha. Depois, abra `https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/admin/`, faça login com cada representante e confirme o isolamento dos históricos, o filtro por período, o total e uma edição de teste.

O Google Apps Script tem limites de execução, armazenamento e requisições. O catálogo é consultado sob demanda, com cache de até 30 segundos, e é consultado novamente ao preparar cada pedido. Falhas e limites impedem a confirmação dos preços e a preparação do pedido. O serviço público pode receber solicitações indevidas; monitore os registros e as cotas e, para operação de maior volume, use um backend com proteção contra abuso e autenticação apropriada.

### Publicar uma atualização de preços

1. No Apps Script existente, atualize os conteúdos de `Code.gs`, `Campaigns.gs` e `Catalog.gs` com os arquivos de `apps-script/`. Ao substituir `Code.gs`, mantenha o ID da sua planilha na constante `SPREADSHEET_ID`; não publique esse ID no GitHub. Não é necessário executar `setup` novamente se a aba `Pedidos` já existir.
2. Salve, execute `checkSetup` e confira o registro. Em **Implantar → Gerenciar implantações**, edite a implantação do app da Web, escolha uma **nova versão** e implante. A edição do código, sem atualizar a implantação, não altera o serviço em uso.
3. Atualize no GitHub os arquivos da pasta `public/`, inclusive `public/admin/`, sem substituir a configuração já existente em `public/config.js`. Aguarde o GitHub Pages publicar e recarregue a página nos dispositivos.
4. Antes de divulgar, confira no aplicativo os preços e as faixas com a Nexfar e faça um pedido de teste autorizado, verificando a planilha e a mensagem do WhatsApp. Atualize frontend e Apps Script como um conjunto: versões antigas não enviam a cotação exigida pelo serviço atualizado.

## Alternativa: executar o servidor Node local

## Executar no Windows

Requisitos: Node.js 18 ou superior e Windows PowerShell. A instalação local usa o arquivo privado `data/admin-users.json`, que fica fora do controle de versão e contém apenas verificadores de senha, nunca as senhas em texto puro. Execute:

```powershell
node server.js
```

Abra `http://localhost:3000/?representante=gabriel` ou `http://localhost:3000/?representante=vanderson`. Cada representante deve distribuir seu próprio link; o cliente não escolhe o representante. O identificador da URL também seleciona o WhatsApp correto e é lembrado no dispositivo caso o cliente instale o aplicativo. O histórico está em `http://localhost:3000/admin`; cada representante entra com seu e-mail e visualiza somente seus pedidos. A área permite pesquisar por período, consultar o total do período, editar razão social, prazo, nome, quantidade e valor dos produtos e recuperar o espelho atualizado. Sem o arquivo de usuários, a preparação de pedidos e o histórico são bloqueados. O servidor usa a porta 3000 e escuta todas as interfaces; configure `HOST`, `PORT` ou `ADMIN_USERS_FILE` conforme necessário.

## Alternativa: publicar com backend Node

1. Hospede o backend em um servidor Windows com processo permanentemente ativo, armazenamento persistente e proxy reverso HTTPS. Restrinja a porta Node à interface interna. Nunca exponha a área administrativa por HTTP: a autenticação Basic só é segura com TLS. Proteja também o acesso ao servidor e à pasta de dados; aplique restrição de acesso e proteção contra tentativas de login no proxy.
2. No servidor configure `ADMIN_USERS_FILE` quando necessário, `HOST=127.0.0.1`, `ALLOWED_ORIGIN=https://gabrielrosa-dev.github.io` e opcionalmente `ORDERS_DIR` para uma pasta privada, persistente e com permissões restritas. O proxy deve encaminhar `/api/*`, `/admin`, `/admin.js`, `/styles.css` e `/extra.css` ao backend. Faça cópias de segurança protegidas dos pedidos. Não inclua `data` ou a pasta `ORDERS_DIR` no Git. Restrinja a área por HTTPS, pois autenticação Basic não protege as credenciais em HTTP.
3. Em `public/config.js`, substitua o valor vazio pela origem HTTPS do backend, por exemplo `https://api.exemplo.com` (sem barra final). Não coloque senhas nesse arquivo.
4. Envie o código ao repositório e selecione **Settings → Pages → Build and deployment → Source: GitHub Actions**. O workflow publica somente `public/`. O Pages, por si só, não salva pedidos, consulta a BrasilAPI nem executa a sincronização PowerShell.
5. Acesse o histórico em `https://<endereço-do-backend>/admin`, nunca no Pages. Teste o fluxo completo e faça um pedido de teste antes da divulgação.

O workflow publica somente o frontend; não hospeda o backend Node nem cria o Apps Script.

## Funcionamento e limitações

- O CNPJ fixo no `sync-catalog.ps1` é usado **somente** para consultar o catálogo Nexfar 2773. O catálogo 2771 retornou indisponível. O CNPJ informado pelo comprador é independente dele.
- O novo link da Nexfar informado para a loja identifica o distribuidor 3 e o catálogo 2773. A integração consulta a API de produtos no novo domínio, mas não usa o parâmetro assinado do link; confirme com o fornecedor se ele altera alguma condição comercial antes de divulgar os preços. Para atualizar uma implantação Apps Script existente, publique uma nova versão do `Code.gs`.
- As seis campanhas fornecidas aparecem em um carrossel automático. Cada banner abre um exemplo fixo, que pode ser adicionado ao carrinho se houver estoque suficiente, inclusive para unidades bonificadas. Os exemplos de mistura e brinde são apenas uma das combinações possíveis; não há seleção de outras opções. Todas usam os preços do catálogo, que podem diferir dos banners. O Pix não é abatido do total e brindes, bonificações, pagamentos, preços e validade da campanha estão sujeitos à confirmação comercial. Os exemplos e as regras ficam em `public/campaigns.js`, compartilhadas com o servidor; revise-as quando uma campanha mudar ou expirar. As imagens publicadas estão em `public/images/campaigns`; para alterá-las, atualize também os slides em `public/index.html`, os fundos em `public/extra.css` e, para execução local, os caminhos permitidos em `server.js`. A inclusão de arquivos na pasta `Campanhas` não os publica automaticamente.
- A loja pode ser instalada como aplicativo web (PWA) em navegadores compatíveis no computador e no celular. A instalação precisa de HTTPS (ou localhost para testes). No iPhone/iPad, use Safari → Compartilhar → Adicionar à Tela de Início; outros navegadores podem exigir o menu de instalação. O aplicativo não é distribuído pelas lojas de aplicativos. Sem internet, ele exibe uma página informativa: catálogo, consulta de CNPJ e pedidos exigem conexão e não são armazenados para uso offline.
- A razão social é consultada automaticamente quando o comprador completa o CNPJ, pela BrasilAPI, um serviço de terceiros baseado em dados públicos; não é uma consulta direta à API oficial da Receita e pode ter defasagem ou indisponibilidade. O backend valida novamente o CNPJ e consulta a razão social ao preparar o pedido. Se a consulta falhar ou não retornar uma razão social, o pedido continua válido com o texto `Razão social não localizada`. A autorização do prazo continua sendo conferida manualmente.
- Com Apps Script, os produtos e preços são buscados diretamente na Nexfar e mantidos temporariamente no cache por até 30 segundos, sem gravá-los na planilha ou em arquivos do Drive. Com o servidor Node, o catálogo é consultado ao iniciar e a cada 30 segundos; o último resultado fica em `data/catalog.json` e é considerado antigo após 90 segundos ou se a atualização falhar. A tela consulta o serviço a cada 30 segundos. Antes de preparar o pedido, ambos os serviços consultam novamente a Nexfar e bloqueiam a preparação se a consulta falhar ou os preços diferirem dos apresentados; o cliente deve revisar o carrinho. Isso não garante atualização instantânea nem reserva de preço ou estoque.
- A consulta do catálogo pelo Apps Script é feita sem credenciais da conta Google do navegador. Consultas de CNPJ e preparação de pedidos usam um fluxo separado; teste também essas etapas nas contas e nos dispositivos dos clientes.
- Para produtos avulsos e campanhas, é usado o `finalPrice` da promoção ativa da Nexfar conforme a faixa de quantidade; se não houver promoção aplicável, usa-se o `finalPrice` normal. Quando ofertas ativas se sobrepõem para uma quantidade, prevalece a oferta com início mais recente; em empate, prevalece o maior `promotionId` numérico da Nexfar. Os cartões destacam o menor preço entre as ofertas ativas e explicam a campanha/faixa necessária; após o cliente escolher uma quantidade, o valor é recalculado pela condição efetivamente aplicável. A faixa considera separadamente a quantidade paga de cada linha avulsa ou de campanha, sem somar bonificações ou outras linhas: confirme essa regra com o fornecedor. Condições promocionais não suportadas impedem a atualização do catálogo. Não são calculados preços subsidiados, negociações ou frete. A consulta utiliza o CNPJ fixo e não calcula preços específicos do comprador. Os preços e o estoque estão sujeitos a confirmação comercial.
- O mínimo é R$ 50,00. O servidor recalcula os valores e verifica estoque e múltiplos de venda; isso não reserva estoque.
- A busca aceita nome, código ou marca, inclusive sem acentos. É possível filtrar produtos disponíveis, ordenar por preço e digitar a quantidade diretamente no carrinho; quantidades devem respeitar o estoque e os múltiplos de venda. Se a atualização falhar, use o botão de tentar novamente.
- Após adicionar um produto avulso, seu cartão mostra a quantidade e o subtotal correspondentes, com botões e campo para ajustar a quantidade; zero remove o item. Itens de campanhas são apresentados separadamente no carrinho. As bolinhas do carrossel permitem escolher uma campanha.
- Ao preparar o pedido, o serviço valida o representante identificado no link (`?representante=gabriel` ou `?representante=vanderson`) e salva CNPJ, razão social, prazo, representante, produtos, quantidades, preços, número, data e mensagem completa antes de gerar o link do WhatsApp. Um novo acesso sem identificador não pode concluir o pedido; se o cliente instalou o aplicativo a partir de um link válido, o representante desse link é lembrado no dispositivo. O histórico é privado na planilha e isolado por representante. A gravação é obrigatória: se falhar, o pedido não é preparado. A área em `https://gabrielrosa-dev.github.io/Pedidos-Ecofitus/admin/` autentica no Apps Script, lista apenas o histórico do representante, calcula o total do período e persiste alterações do espelho na linha correspondente da planilha. Tentativas de senha são limitadas, e as senhas não são publicadas no código do site.
- Após salvar o pedido, a loja tenta abrir o WhatsApp e mantém um link para o último pedido preparado, caso a abertura seja bloqueada. O cliente precisa confirmar o envio no WhatsApp. O histórico comprova apenas que o pedido foi preparado, **não** que a mensagem foi enviada ou recebida. A equipe pode recuperar a mensagem na área administrativa.
- O histórico contém dados comerciais: mantenha backups, controle de acesso, política de retenção e uma política de privacidade adequados. Com Apps Script, fica na planilha privada; com Node, fica por padrão em `data/orders` e deve usar volume persistente privado.

## Testes

```powershell
node --test
```
