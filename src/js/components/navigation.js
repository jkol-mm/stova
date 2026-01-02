const handleHeaderActions = () => {
    const headerTopButtons = document.querySelector(".header-top .navigation-buttons");
    const navigationActions = document.querySelector("#navigation .navigationActions");
    const contactsLi = document.querySelector("#navigation ul li:has(a[href='/kontakty/'])");

    if(!headerTopButtons) return

    
    if(navigationActions) {
        const link = navigationActions.querySelector("a")
        link.classList.add("header-actions")
        headerTopButtons.insertAdjacentElement("afterbegin", link)
        navigationActions.remove()
    }
    if(contactsLi) {
        const link = contactsLi.querySelector("a")
        link.classList.add("header-contacts")
        headerTopButtons.insertAdjacentElement("afterbegin", link)
        contactsLi.remove()
    }

}

export {
    handleHeaderActions,
}