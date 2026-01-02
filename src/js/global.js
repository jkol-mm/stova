const splitMenu = () => {
    const menuWrapper = document.querySelector("#navigation .menu-level-1")
    if(menuWrapper) {
        setTimeout(() => {
        let menuItems = menuWrapper.querySelectorAll(".menu-level-1>li")
        if(!menuItems.length) return;

        for(let i = 0; i < menuItems.length; i++) {
            //TO DO: Finish split menu logic
        }

        }, 50)

    }
}

export {
    splitMenu,
}