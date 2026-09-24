import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de Privacidade | ImobFlow',
  description: 'Como o ImobFlow trata dados de cadastro e atendimento e como solicitar acesso ou exclusão.',
};

export default function PrivacyPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#faf9fc', color: '#252239', padding: '48px 24px', lineHeight: 1.75 }}>
      <article style={{ maxWidth: 780, margin: '0 auto' }}>
        <Link href="/" style={{ color: '#6241ba' }}>← Voltar ao ImobFlow</Link>
        <header style={{ margin: '36px 0' }}>
          <p>ImobFlow · Privacidade e atendimento</p>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', lineHeight: 1.2 }}>Política de Privacidade</h1>
          <p>Atualizada em 11 de setembro de 2026.</p>
        </header>
        <section>
          <h2>Sobre esta política</h2>
          <p>O ImobFlow é uma plataforma de atendimento e gestão imobiliária. Esta política abrange o site, o painel e a integração com o WhatsApp Business. Para assuntos de privacidade, entre em contato com <a href="mailto:imobflow.ai@gmail.com">imobflow.ai@gmail.com</a>.</p>
          <p>A imobiliária que atende você define a finalidade do atendimento e utiliza os dados de seus clientes. O ImobFlow fornece a plataforma para esse tratamento e administra os dados necessários ao funcionamento das contas e do serviço.</p>
        </section>
        <section>
          <h2>Dados tratados e finalidades</h2>
          <ul>
            <li>Nome, telefone, e-mail e dados da empresa para cadastro, identificação, contato e recuperação de acesso.</li>
            <li>Mensagens, fotos enviadas, horários, identificadores de conversa e status de entrega para permitir o atendimento pelo WhatsApp e pelo painel.</li>
            <li>Preferências de compra ou aluguel, região, tipo de imóvel, orçamento e agendamentos para organizar a busca e apresentar imóveis compatíveis.</li>
            <li>Dados técnicos de acesso, sessões e registros de erros para autenticação, segurança e diagnóstico do serviço.</li>
          </ul>
          <p>O tratamento ocorre conforme a finalidade e a base legal aplicável, incluindo atendimento solicitado e execução contratual, consentimento quando necessário, obrigações legais e interesses legítimos avaliados com respeito aos direitos do titular. Evite enviar documentos ou dados sensíveis que não sejam necessários ao atendimento.</p>
        </section>
        <section>
          <h2>Quem pode acessar</h2>
          <p>As informações de atendimento ficam disponíveis à equipe autorizada da imobiliária responsável. A operação utiliza fornecedores de infraestrutura e comunicação, incluindo Meta/WhatsApp, Vercel, Supabase, Neon e, quando configurado, Resend para e-mails. Recursos opcionais de inteligência artificial podem utilizar a OpenAI para processar dados necessários à função habilitada.</p>
          <p>Esses serviços podem processar dados fora do Brasil e possuem políticas próprias. Solicite pelo nosso contato informações sobre os fornecedores utilizados no seu atendimento. Dados também poderão ser disponibilizados quando exigido por obrigação legal.</p>
        </section>
        <section>
          <h2>Armazenamento e segurança</h2>
          <p>O sistema utiliza autenticação, controle de acesso por empresa e armazenamento de senhas em formato de hash. Cookies de sessão permitem manter o acesso ao painel. O histórico permanece armazenado para continuidade do atendimento; sua exclusão pode ser solicitada pelo procedimento abaixo. A retenção depende da finalidade do registro, da relação com a imobiliária e de obrigações legais aplicáveis. Nenhum sistema oferece garantia absoluta de segurança.</p>
        </section>
        <section>
          <h2>Atendimento automatizado</h2>
          <p>A plataforma pode organizar preferências, sugerir imóveis e responder automaticamente. Você pode solicitar atendimento humano e esclarecimentos ou revisão de resultados automatizados pelo canal de contato.</p>
        </section>
        <section id="exclusao-de-dados" style={{ scrollMarginTop: 24 }}>
          <h2>Seus direitos e exclusão de dados</h2>
          <p>Para solicitar acesso, correção, informações sobre compartilhamento, revogação de consentimento ou exclusão dos seus dados, escreva para <a href="mailto:imobflow.ai@gmail.com?subject=Privacidade%20-%20ImobFlow">imobflow.ai@gmail.com</a>. Para excluir dados, use o assunto “Exclusão de dados — ImobFlow”.</p>
          <ol>
            <li>Informe o telefone ou e-mail utilizado no atendimento e o nome da imobiliária, se souber.</li>
            <li>Descreva os dados ou a conta que deseja excluir. Não envie senhas, tokens ou documentos desnecessários.</li>
            <li>A equipe poderá confirmar sua identidade e coordenar a solicitação com a imobiliária responsável. A resposta será enviada por e-mail, com o resultado e eventuais motivos de retenção legal.</li>
          </ol>
          <p>A solicitação é analisada conforme os direitos e exceções previstos na legislação. Excluir informações no ImobFlow não apaga automaticamente cópias no seu WhatsApp ou em outros serviços. Saiba mais sobre o exercício de direitos nas <a href="https://www.gov.br/pt-br/servicos/abrir-requerimento-relacionado-a-lgpd">orientações da ANPD</a>.</p>
        </section>
        <section>
          <h2>Atualizações e contato</h2>
          <p>Alterações nesta política serão publicadas nesta página com a data de atualização. Dúvidas e solicitações: <a href="mailto:imobflow.ai@gmail.com">imobflow.ai@gmail.com</a>.</p>
        </section>
      </article>
    </main>
  );
}
