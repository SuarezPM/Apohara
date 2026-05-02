const { exec } = require("child_process");
exec(`xdg-open "http://google.com"`, (error) => {
    if (error) {
        console.error("Error:", error.message);
        process.exit(1);
    }
    console.log("Success");
});
