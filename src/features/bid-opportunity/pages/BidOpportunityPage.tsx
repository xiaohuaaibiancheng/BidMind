function BidOpportunityPage() {
  return (
    <div className="demo-coming-page opportunity-demo">
      <div className="feature-under-development-overlay" role="status" aria-live="polite">
        <strong>正在开发中，暂不可用</strong>
        <span>投标机会模块暂未开放，请等待后续版本。</span>
      </div>
      <section className="demo-hero-card opportunity-hero-card">
        <div className="demo-hero-copy">
          <span className="section-kicker">投标机会</span>
          <h2>机会筛选与决策（开发中）</h2>
          <p>该模块后续会支持线索聚合、机会评分与历史决策追踪，当前版本不开放实际操作入口。</p>
          <div className="demo-hero-actions">
            <button type="button" className="primary-action" disabled>暂未开放</button>
          </div>
        </div>
      </section>

      <section className="demo-panel">
        <div className="demo-panel-head">
          <div>
            <span className="section-kicker">计划能力</span>
            <h3>后续将提供</h3>
          </div>
        </div>
        <ul className="quiet-list check-list">
          <li>公告线索聚合与项目级历史沉淀</li>
          <li>结合企业资质和业绩进行机会评分</li>
          <li>记录“参与/放弃”决策与复盘备注</li>
        </ul>
      </section>
    </div>
  );
}

export default BidOpportunityPage;
