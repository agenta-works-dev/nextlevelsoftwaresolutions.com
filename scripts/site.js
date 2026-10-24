import {
  purchaseOrder,
  acknowledgementExamples,
  compareOrder,
} from "./order-example.js";

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = new Date().getFullYear();
});
const menuButton = document.querySelector("[data-menu-toggle]");
const menu = document.querySelector("[data-menu]");
if (menuButton && menu) {
  const closeMenu = () => {
    menuButton.setAttribute("aria-expanded", "false");
    menu.classList.remove("is-open");
  };
  menuButton.addEventListener("click", () => {
    const expanded = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(expanded));
    menu.classList.toggle("is-open", expanded);
  });
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      menuButton.getAttribute("aria-expanded") === "true"
    ) {
      closeMenu();
      menuButton.focus();
    }
  });
}

const example = document.querySelector("[data-order-example]");
if (example) {
  const update = (scenario) => {
    const acknowledgement = acknowledgementExamples[scenario];
    const differences = compareOrder(purchaseOrder, acknowledgement);
    example.querySelectorAll("[data-scenario]").forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.scenario === scenario),
      );
    });
    example.querySelectorAll("[data-ack-field]").forEach((element) => {
      const field = element.dataset.ackField;
      const value = acknowledgement[field];
      element.textContent =
        field === "unitPrice"
          ? `$${value.toFixed(2)}`
          : field === "delivery"
            ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })
            : String(value);
      element.classList.toggle(
        "has-difference",
        differences.some((change) => change.field === field),
      );
    });
    const status = example.querySelector("[data-order-status]");
    status.textContent = differences.length
      ? `${differences.length} differences need a closer look`
      : "These three fields match";
    status.classList.toggle("is-match", differences.length === 0);
    const findings = example.querySelector("[data-order-findings]");
    findings.replaceChildren();
    for (const difference of differences) {
      const li = document.createElement("li");
      li.textContent = difference.label;
      findings.append(li);
    }
    if (!differences.length) {
      const li = document.createElement("li");
      li.textContent =
        "Quantity, unit price, and delivery date match. Other terms still need their usual review.";
      findings.append(li);
    }
  };
  example.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => update(button.dataset.scenario));
  });
  update("differences");
}
