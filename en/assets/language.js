/* Close the native language disclosure on Escape, without trapping focus. */
document.addEventListener("keydown", (event) => {
  const menu = document.querySelector(".documentation-language[open]");
  if (event.key === "Escape" && menu) {
    menu.removeAttribute("open");
    menu.querySelector("summary").focus();
  }
});
