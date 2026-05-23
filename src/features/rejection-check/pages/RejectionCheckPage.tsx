function RejectionCheckPage() {
  return (
    <div className="page-stack">
      <div className="feature-under-development-overlay" role="status" aria-live="polite">
        <strong>正在开发中，暂不可用</strong>
        <span>废标项检查功能暂未开放，请等待后续版本。</span>
      </div>
      <section className="hero-panel compact-hero">
        <div>
          <span className="section-kicker">合规底线</span>
          <h2>废标项检查（开发中）</h2>
          <p>该模块将用于硬性条款与响应完整性核验，当前版本先隐藏实际能力入口。</p>
        </div>
        <button type="button" className="primary-action" disabled>暂未开放</button>
      </section>

      <section className="panel checklist-panel">
        <div className="panel-heading">
          <span className="section-kicker">计划能力</span>
        </div>
        <ul className="quiet-list">
          <li>资格条件、签章、工期与格式等硬性条款自动扫描</li>
          <li>按项目沉淀历史记录并支持复核备注</li>
          <li>对高风险项给出整改建议和证据定位</li>
        </ul>
      </section>
    </div>
  );
}

export default RejectionCheckPage;
