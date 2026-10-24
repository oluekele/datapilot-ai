import Link from "next/link";
import { OnboardingGuide } from "@/components/onboarding-guide";
import { PricingSection } from "@/components/pricing-section";
import { ThemeToggle } from "@/components/theme-toggle";

const workflow = [
  { number: "01", title: "Bring your data", text: "Upload a CSV or Excel file into a private workspace." },
  { number: "02", title: "Understand it", text: "Review quality signals, distributions, relationships, and caveats." },
  { number: "03", title: "Make careful changes", text: "Preview and approve repairs while preserving the original version." },
  { number: "04", title: "Share the outcome", text: "Save analysis history and export reproducible reports." },
];

export default function Home() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DataPilot home">
          <span className="brand-mark" aria-hidden="true">D</span>
          <span>datapilot<span className="brand-dot">.</span></span>
        </a>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="#workflow">How it works</a>
          <a href="#security">Security</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <div className="top-actions">
          <button className="text-button" type="button" data-open-guide="true">
            Product tour
          </button>
          <ThemeToggle />
          <Link className="text-button" href="/login">Sign in</Link>
          <Link className="button button-pop button-small" href="/register">
            Get started <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> THE DATA WORKSPACE FOR TEAMS</div>
          <h1>Make better calls<br />with <em>cleaner data.</em></h1>
          <p className="hero-lede">
            One calm place to understand your data, review repairs, explore patterns,
            and prepare for machine learning—with your original files kept safe.
          </p>
          <div className="hero-actions" id="workspace">
            <Link className="button button-pop" href="/register">Create your workspace <span aria-hidden="true">→</span></Link>
            <button className="button button-light" type="button" data-open-guide="true">Take the 2-minute tour</button>
          </div>
          <div className="trust-note"><span aria-hidden="true">✳</span> Built for transparent, reviewable data work</div>
        </div>

        <div className="hero-visual" aria-label="Preview of a dataset health report">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="report-card">
            <div className="card-topline"><span className="mini-logo">D</span><span>WORKSPACE / OVERVIEW</span><span className="status-pill"><i /> READY</span></div>
            <div className="report-heading"><div><div className="muted-label">CUSTOMER CHURN · CSV</div><h2>Dataset health</h2></div><span className="file-icon">↗</span></div>
            <div className="score-row"><div className="score-ring"><span>86</span><small>/100</small></div><div><strong>Good foundation</strong><p>3 items worth reviewing</p></div></div>
            <div className="data-bars" aria-label="Quality checks">
              <div><span>Completeness</span><b>94%</b><i><em style={{ width: "94%" }} /></i></div>
              <div><span>Consistency</span><b>88%</b><i><em style={{ width: "88%" }} /></i></div>
              <div><span>Duplicates</span><b>Clear</b><i><em className="bar-green" style={{ width: "100%" }} /></i></div>
            </div>
            <div className="card-footer"><span><i className="sparkle">✳</i> Original data preserved</span><span>View report <b>→</b></span></div>
          </div>
          <div className="float-note"><span className="float-check">✓</span><span><b>Changes stay in your hands</b><small>Review before applying</small></span></div>
          <div className="visual-caption">A clearer view of what your data can do.</div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Product principles">
        <div><span className="proof-icon">◈</span><span><b>Originals stay untouched</b><small>Repairs create a separate version</small></span></div>
        <div><span className="proof-icon">⌁</span><span><b>Every result has context</b><small>Warnings and limitations included</small></span></div>
        <div><span className="proof-icon">▤</span><span><b>Workflows built for teams</b><small>Designed around shared workspaces</small></span></div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-intro"><div className="eyebrow">FROM UPLOAD TO UNDERSTANDING</div><h2>A thoughtful process.<br /><em>No black boxes.</em></h2><p>Move through each stage at your pace. DataPilot explains what it found and leaves consequential decisions to you.</p></div>
        <div className="workflow-grid">
          {workflow.map((item) => (
            <article className="workflow-card" key={item.number}>
              <span className="workflow-number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <span className="workflow-arrow" aria-hidden="true">↗</span>
            </article>
          ))}
        </div>
      </section>

      <PricingSection />

      <section className="security-section" id="security">
        <div className="security-icon" aria-hidden="true">✳</div>
        <div><div className="eyebrow">PRIVACY IS A PRODUCT FEATURE</div><h2>Your data deserves<br />a <em>careful home.</em></h2></div>
        <p>Private workspaces, organisation-level access, and auditable actions are foundational to the platform—not extras to bolt on later.</p>
      </section>

      <footer className="footer"><a className="brand" href="#top"><span className="brand-mark">D</span><span>datapilot<span className="brand-dot">.</span></span></a><span>Understand your data. Move with confidence.</span><span>© 2026 DataPilot AI</span></footer>
      <OnboardingGuide />
    </main>
  );
}
