# Pedidos Ecofitus

Loja com catálogo, consulta de razão social, histórico privado e pedido por WhatsApp. O frontend pode ser publicado no GitHub Pages, **mas o Pages não executa o backend**. Para a loja funcionar publicamente é necessário também um servidor Windows com Node.js, PowerShell, armazenamento persistente e HTTPS.

## Executar no Windows

Requisitos: Node.js 18 ou superior e Windows PowerShell. Defina uma senha forte e única de pelo menos 16 caracteres em variável de ambiente, fora do código e do repositório, e execute:

```powershell
$env:ADMIN_PASSWORD = '<defina-uma-senha-forte>'
node server.js
```

Abra `http://localhost:3000`. O histórico está em `http://localhost:3000/admin`, usuário `admin` e a senha configurada. Sem essa senha, a preparação de pedidos e o histórico são bloqueados. O servidor usa a porta 3000 e escuta todas as interfaces; configure `HOST` e `PORT` conforme necessário.

## Publicação com GitHub Pages

1. Hospede o backend em um servidor Windows com processo permanentemente ativo, armazenamento persistente e proxy reverso HTTPS. Restrinja a porta Node à interface interna. Nunca exponha a área administrativa por HTTP: a autenticação Basic só é segura com TLS. Proteja também o acesso ao servidor e à pasta de dados; aplique restrição de acesso e proteção contra tentativas de login no proxy.
2. No servidor configure `ADMIN_PASSWORD`, `HOST=127.0.0.1`, `ALLOWED_ORIGIN=https://gabrielrosa-dev.github.io` e opcionalmente `ORDERS_DIR` para uma pasta privada, persistente e com permissões restritas. O proxy deve encaminhar `/api/*`, `/admin`, `/admin.js`, `/styles.css` e `/extra.css` ao backend. Faça cópias de segurança protegidas dos pedidos. Não inclua `data` ou a pasta `ORDERS_DIR` no Git.
3. Em `public/config.js`, substitua o valor vazio pela origem HTTPS do backend, por exemplo `https://api.exemplo.com` (sem barra final). Não coloque senhas nesse arquivo.
4. Envie o código ao repositório e selecione **Settings → Pages → Build and deployment → Source: GitHub Actions**. O workflow publica somente `public/`. O Pages, por si só, não salva pedidos, consulta a BrasilAPI nem executa a sincronização PowerShell.
5. Acesse o histórico em `https://<endereço-do-backend>/admin`, nunca no Pages. Teste o fluxo completo e faça um pedido de teste antes da divulgação.

Não houve implantação automática: o endereço de backend ainda não foi fornecido. O workflow não configura uma hospedagem para o backend.

## Funcionamento e limitações

- O CNPJ fixo no `sync-catalog.ps1` é usado **somente** para consultar o catálogo Nexfar 2773. O catálogo 2771 retornou indisponível. O CNPJ informado pelo comprador é independente dele.
- As cinco campanhas fornecidas aparecem em um carrossel automático. Cada banner abre um exemplo fixo, que pode ser adicionado ao carrinho se houver estoque suficiente, inclusive para unidades bonificadas. Os exemplos de mistura e brinde são apenas uma das combinações possíveis; não há seleção de outras opções. A campanha do chopp usa R$ 24,99 por unidade e a do Regulax usa R$ 19,12, conforme os banners; as demais usam preços atuais do catálogo. O Pix não é abatido do total e brindes, bonificações, pagamentos, preços e validade da campanha estão sujeitos à confirmação comercial. Os exemplos e as regras ficam em `public/campaigns.js`, compartilhadas com o servidor; revise-as quando uma campanha mudar ou expirar. As imagens publicadas estão em `public/images/campaigns`; para alterá-las, atualize também os slides em `public/index.html` e, para execução local, os caminhos permitidos em `server.js`. A inclusão de arquivos na pasta `Campanhas` não os publica automaticamente.
- A loja pode ser instalada como aplicativo web (PWA) em navegadores compatíveis no computador e no celular. A instalação precisa de HTTPS (ou localhost para testes). No iPhone/iPad, use Safari → Compartilhar → Adicionar à Tela de Início; outros navegadores podem exigir o menu de instalação. O aplicativo não é distribuído pelas lojas de aplicativos. Sem internet, ele exibe uma página informativa: catálogo, consulta de CNPJ e pedidos exigem conexão e não são armazenados para uso offline.
- A razão social é consultada automaticamente quando o comprador completa o CNPJ, pela BrasilAPI, um serviço de terceiros baseado em dados públicos; não é uma consulta direta à API oficial da Receita e pode ter defasagem ou indisponibilidade. O backend valida novamente o CNPJ e consulta a razão social ao preparar o pedido; se a consulta falhar, o pedido não é preparado. A autorização do prazo continua sendo conferida manualmente.
- O catálogo é consultado ao iniciar e a cada cinco minutos, em todas as páginas. O último resultado é armazenado em `data/catalog.json`. Se a atualização falhar, o último catálogo continua visível; pedidos são bloqueados se estiver há mais de dez minutos sem atualização.
- Fora das campanhas, o preço unitário é o `finalPrice` da tabela normal da API, sem promoções, preços subsidiados, negociações ou frete. A consulta utiliza o CNPJ fixo e não calcula preços específicos do comprador. Os preços e o estoque estão sujeitos a confirmação comercial.
- O mínimo é R$ 50,00. O servidor recalcula os valores e verifica estoque e múltiplos de venda; isso não reserva estoque.
- Ao preparar o pedido, o servidor salva CNPJ, razão social, prazo, produtos, quantidades, preços, número, data e mensagem completa antes de gerar o link do WhatsApp. O histórico é privado e separado dos arquivos publicados no Pages. A gravação é obrigatória: se falhar, o pedido não é preparado. Tentativas com o mesmo identificador e dados reaproveitam o pedido salvo.
- O cliente precisa clicar no link e confirmar o envio no WhatsApp. O histórico comprova apenas que o pedido foi preparado, **não** que a mensagem foi enviada ou recebida. A equipe pode recuperar a mensagem na área administrativa.
- O histórico contém dados comerciais: mantenha backups, controle de acesso, política de retenção e uma política de privacidade adequados. A configuração padrão armazena os arquivos em `data/orders`; em servidor, use volume persistente privado.

## Testes

```powershell
node --test
```
