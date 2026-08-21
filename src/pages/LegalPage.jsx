const legalContent = {
  privacy: {
    title: 'Privacy Policy',
    meta: 'Last updated: April 2026',
    sections: [
      ['Data We Collect', 'We collect your name, email address, phone number, store details, delivery details, messages, and transaction history to provide marketplace services. Payment data is processed securely by Paystack and is not stored on BUYSELL servers.'],
      ['How We Protect Your Data', 'Data is encrypted in transit using SSL/TLS and stored through Supabase infrastructure. We do not sell your personal information to third parties.'],
      ['Information Sharing', 'Delivery details are shared only with sellers to fulfill orders. Service provider contact information may be visible to potential clients on the platform. We may share data with law enforcement or regulators when legally required.'],
      ['Your Rights', 'You may request deletion of your account and personal data from your BUYSELL account page. Some order, dispute, fraud-prevention, tax, and accounting records may be retained where required by law or legitimate marketplace safety obligations. Nigerian data protection regulations apply.'],
      ['Account Deletion', 'Signed-in users can open their account page from the profile icon and choose Delete My Account. This removes the login account and personal profile where possible. You can also contact support@buysell.ng for help with privacy requests.'],
    ],
  },
  terms: {
    title: 'Terms of Service & Marketplace Agreement',
    meta: 'Last updated: April 2026',
    sections: [
      ['1. General Terms', 'By creating an account on BUYSELL Nigeria, you agree to be bound by these Terms of Service. BUYSELL operates as a marketplace platform connecting buyers, sellers, and service providers. We do not directly sell products or services; we provide the platform infrastructure.'],
      ['2. Seller Obligations', ['All listed products must be genuine and accurately described.', 'Sellers must respond to orders within 24 hours.', 'Seller dashboard access is currently free; no monthly subscription is required to maintain an active store.', 'BUYSELL may introduce optional paid promotions or premium services, but basic seller access remains available without subscription fees unless these terms are updated.', 'Fraudulent or misleading listings may result in immediate account termination.']],
      ['3. Buyer Protection', ['Purchases made via Paystack are protected by BUYSELL\'s Buyer Protection policy.', 'If a product does not match its description, buyers can open a dispute within 7 days of delivery.', 'For bank transfer orders, buyers must upload payment proof. Disputes are resolved by admin review.', 'Reviews must reflect genuine purchasing experiences. Fake reviews may be removed.']],
      ['4. Service Provider Agreement', ['Service providers must accurately describe their skills, experience, and pricing.', 'All work must be delivered as agreed with the client.', 'Communication must remain professional. BUYSELL may remove inappropriate content.', 'Service providers are independent contractors, not employees of BUYSELL Nigeria.']],
      ['5. Prohibited Activities', ['Selling counterfeit, stolen, or illegal goods.', 'Manipulating reviews or ratings.', 'Harassing other users.', 'Using the platform for money laundering or fraudulent transactions.', 'Attempting to bypass required transaction safety checks or platform rules.']],
      ['6. Dispute Resolution', 'Disputes between buyers and sellers are handled by the BUYSELL admin team. Both parties must provide evidence. Admin decisions are final. Unresolved disputes may be escalated to the appropriate Nigerian consumer protection authority.'],
      ['7. Account Termination', 'BUYSELL reserves the right to suspend or terminate any account that violates these terms. Suspended accounts may appeal by contacting support within 14 days.'],
      ['8. Questions', 'For questions about these terms, contact support@buysell.ng.'],
    ],
  },
};

export default function LegalPage({ page }) {
  const content = legalContent[page] || legalContent.privacy;
  document.body.className = 'legal-page';
  document.title = `${content.title} | BUYSELL Nigeria`;

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/?view=shop';
    }
  };

  return (
    <>
      <header className="legal-page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-outline btn-sm" onClick={handleBack} type="button" title="Back">
            <i className="fa-solid fa-arrow-left" /> Back
          </button>
          <a href="/?view=shop" className="brand-logo">
            <div className="brand-icon">B</div>
            <div><div className="brand-text">BUY<span>SELL</span></div><div className="brand-tld">.nigeria</div></div>
          </a>
        </div>
      </header>
      <main className="legal-page-main">
        <article className="legal-document">
          <h1>{content.title}</h1>
          <p className="legal-document__meta">{content.meta}</p>
          {content.sections.map(([title, body]) => (
            <section key={title}>
              <h2>{title}</h2>
              {Array.isArray(body) ? <ul>{body.map(item => <li key={item}>{item}</li>)}</ul> : <p>{body}</p>}
            </section>
          ))}
          <div className="legal-page-links">
            <button className="btn btn-primary" onClick={handleBack} type="button">
              <i className="fa-solid fa-arrow-left" /> Back to Previous
            </button>
            <a className="btn btn-outline" href="/?view=shop">Marketplace</a>
            <a className="btn btn-outline" href={page === 'privacy' ? '/terms' : '/privacy'}>{page === 'privacy' ? 'Terms of Service' : 'Privacy Policy'}</a>
            <a className="btn btn-outline" href="https://chat.whatsapp.com/LbqLGlmpqwbJqDEmj6FUPW?s=cl&p=a&ilr=1" target="_blank" rel="noopener noreferrer"><i className="fa-brands fa-whatsapp" /> Community</a>
            <a className="btn btn-outline" href="https://youtube.com/@buysellmarketplacenigeria?si=hz5EL1weqka8ikG1" target="_blank" rel="noopener noreferrer"><i className="fa-brands fa-youtube" /> YouTube</a>
          </div>
        </article>
      </main>
    </>
  );
}
