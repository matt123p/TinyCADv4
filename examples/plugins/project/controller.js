export function activate(api) {
  api.commands.registerHandler('net.tinycad.project.open', () => api.views.open('net.tinycad.project.home'));
}
