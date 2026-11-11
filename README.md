# Pedidos Ecofitus

Loja de catálogo com pesquisa, carrinho e envio de pedido pelo WhatsApp. O servidor usa PowerShell para consultar o catálogo Nexfar **2773**, com o CNPJ de acesso fornecido para essa consulta. O catálogo 2771 informado inicialmente retornou indisponível.

## Executar no Windows

Requisitos: Node.js 18 ou superior e Windows PowerShell. Na pasta do projeto:

```powershell
node server.js
```

Abra `http://localhost:3000`. O servidor escuta em todas as interfaces, na porta 3000; `HOST` e `PORT` podem ser configurados por variáveis de ambiente. Para outras pessoas acessarem pela internet, é necessário hospedar o serviço em um servidor Windows com Node.js e PowerShell, configurar domínio e HTTPS por um proxy reverso e manter o processo em execução. O endereço localhost não publica a loja na internet.

## Funcionamento e limitações

- Os produtos são buscados no início e a cada cinco minutos; todas as páginas são percorridas. Uma cópia do último catálogo é salva em `data/catalog.json`. Se a atualização falhar, o catálogo anterior continua visível; pedidos são bloqueados quando a última atualização tem mais de dez minutos. Erros são mostrados na loja e registrados no console.
- O preço unitário exibido é o `finalPrice` da tabela normal da API. Quando a API não confirma o cálculo dos impostos, essa situação é indicada no produto. Promoções, preços subsidiados, negociações e frete não são aplicados automaticamente. A consulta utiliza o CNPJ fixo informado pelo proprietário; a aplicação não consulta preços específicos do CNPJ comprador.
- O pedido mínimo é R$ 50,00 em produtos. O servidor recalcula os valores e verifica estoque e múltiplos de venda antes de preparar o pedido. A consulta não reserva estoque nem garante preço; pedido, preço e disponibilidade precisam de confirmação comercial.
- O comprador informa o CNPJ e o prazo. O CNPJ tem seus dígitos verificadores validados, mas o prazo **não é consultado nem validado como liberado**: deve ser conferido pela equipe comercial até que a lista ou integração seja fornecida.
- O envio abre o WhatsApp para o número configurado em `server.js`. O usuário deve clicar em “Enviar pedido pelo WhatsApp” e confirmar o envio no WhatsApp. O aplicativo não registra o pedido na Nexfar nem salva dados do comprador; o CNPJ, prazo e itens são compartilhados na mensagem.
- O catálogo pode conter preços comerciais. Antes de disponibilizar publicamente, confirme a autorização para exposição dos preços e integração com o fornecedor.

## Testes

```powershell
node --test
```
